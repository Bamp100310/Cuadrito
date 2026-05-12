class CodexAgent extends Agent {
    constructor() {
        super();
        this.SAFE_LIMIT = 72;
        this.FORCED_LIMIT = 36;
    }

    init(color, board, time) {
        super.init(color, board, time);
        const N = this.size;
        this.N = N;
        this.myPly = (color === 'R') ? -1 : -2;
        this.oppPly = (color === 'R') ? -2 : -1;

        const hC = (N + 1) * N;
        const vC = N * (N + 1);
        this.hCount = hC;
        this.totalEdges = hC + vC;
        this.totalPlayable = 2 * N * (N - 1);

        this.edges = new Uint8Array(this.totalEdges);
        this.cellSides = new Uint8Array(N * N);
        this.cellOwner = new Int8Array(N * N);
        this.eAdj = new Int16Array(this.totalEdges * 2).fill(-1);
        this.cEdges = new Int16Array(N * N * 4);
        this.act0 = new Int8Array(this.totalEdges * 3).fill(-1);
        this.act1 = new Int8Array(this.totalEdges * 3).fill(-1);

        this._buildTables(N, hC);

        const maxCells = N * N;
        this.capStk = new Int16Array(maxCells);
        this.autoStk = new Int16Array(maxCells);
        this.capTop = 0;
        this.autoTop = 0;

        this.buffers = [];
        for (let i = 0; i < 80; i++) {
            this.buffers[i] = {
                safe: new Int16Array(this.totalEdges),
                risky: new Int16Array(this.totalEdges),
                sc: 0,
                rc: 0
            };
        }

        this.root = new Int16Array(this.totalEdges);
        this.rootScore = new Int32Array(this.totalEdges);
        this.scoreR = 0;
        this.scoreY = 0;
        this.movesLeft = 0;
        this.riskCells = 0;
        this.nodeCnt = 0;
        this.timeUp = false;
        this.tStart = 0;
        this.tLimit = 0;
    }

    _buildTables(N, hC) {
        for (let eid = 0; eid < hC; eid++) {
            const r = (eid / N) | 0;
            const c = eid % N;
            let k = 0;
            if (r < N) {
                this.eAdj[eid * 2 + k] = r * N + c;
                this._setAction(k === 0 ? this.act0 : this.act1, eid, r, c, 0);
                k++;
            }
            if (r > 0) {
                this.eAdj[eid * 2 + k] = (r - 1) * N + c;
                this._setAction(k === 0 ? this.act0 : this.act1, eid, r - 1, c, 2);
            }
        }

        const vC = N * (N + 1);
        for (let i = 0; i < vC; i++) {
            const eid = hC + i;
            const r = (i / (N + 1)) | 0;
            const c = i % (N + 1);
            let k = 0;
            if (c < N) {
                this.eAdj[eid * 2 + k] = r * N + c;
                this._setAction(k === 0 ? this.act0 : this.act1, eid, r, c, 3);
                k++;
            }
            if (c > 0) {
                this.eAdj[eid * 2 + k] = r * N + (c - 1);
                this._setAction(k === 0 ? this.act0 : this.act1, eid, r, c - 1, 1);
            }
        }

        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                const b = (r * N + c) * 4;
                this.cEdges[b] = r * N + c;
                this.cEdges[b + 1] = hC + r * (N + 1) + c + 1;
                this.cEdges[b + 2] = (r + 1) * N + c;
                this.cEdges[b + 3] = hC + r * (N + 1) + c;
            }
        }
    }

    _setAction(arr, eid, r, c, s) {
        const b = eid * 3;
        arr[b] = r;
        arr[b + 1] = c;
        arr[b + 2] = s;
    }

    syncFromBoard(board) {
        const N = this.N;
        const totalCells = N * N;
        this.edges.fill(0);
        this.cellSides.fill(0);
        this.cellOwner.fill(0);
        this.scoreR = 0;
        this.scoreY = 0;
        this.riskCells = 0;
        this.movesLeft = 0;
        this.capTop = 0;
        this.autoTop = 0;

        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                const cid = r * N + c;
                const value = board[r][c];
                const b = cid * 4;
                if (value < 0) {
                    this.cellOwner[cid] = value;
                    this.edges[this.cEdges[b]] = 1;
                    this.edges[this.cEdges[b + 1]] = 1;
                    this.edges[this.cEdges[b + 2]] = 1;
                    this.edges[this.cEdges[b + 3]] = 1;
                    if (value === -1) this.scoreR++;
                    else this.scoreY++;
                } else {
                    if (value & 1) this.edges[this.cEdges[b]] = 1;
                    if (value & 2) this.edges[this.cEdges[b + 1]] = 1;
                    if (value & 4) this.edges[this.cEdges[b + 2]] = 1;
                    if (value & 8) this.edges[this.cEdges[b + 3]] = 1;
                }
            }
        }

        for (let cid = 0; cid < totalCells; cid++) {
            if (this.cellOwner[cid]) {
                this.cellSides[cid] = 4;
                continue;
            }
            const b = cid * 4;
            let cnt = 0;
            if (this.edges[this.cEdges[b]]) cnt++;
            if (this.edges[this.cEdges[b + 1]]) cnt++;
            if (this.edges[this.cEdges[b + 2]]) cnt++;
            if (this.edges[this.cEdges[b + 3]]) cnt++;
            this.cellSides[cid] = cnt;
            if (cnt >= 2) this.riskCells++;
        }

        for (let e = 0; e < this.totalEdges; e++) {
            if (!this.edges[e]) this.movesLeft++;
        }
    }

    _inc(cid) {
        const old = this.cellSides[cid];
        this.cellSides[cid] = old + 1;
        if (!this.cellOwner[cid]) {
            if (old === 1) this.riskCells++;
        }
    }

    _dec(cid) {
        const old = this.cellSides[cid];
        this.cellSides[cid] = old - 1;
        if (!this.cellOwner[cid]) {
            if (old === 2) this.riskCells--;
        }
    }

    makeMove(eid, curPlayer) {
        const sCT = this.capTop;
        const sAT = this.autoTop;
        const receiver = (curPlayer === -1) ? -2 : -1;

        this.edges[eid] = 1;
        this.movesLeft--;
        const c0 = this.eAdj[eid * 2];
        const c1 = this.eAdj[eid * 2 + 1];
        if (c0 !== -1) this._inc(c0);
        if (c1 !== -1) this._inc(c1);

        if (c0 !== -1 && this.cellSides[c0] >= 3 && !this.cellOwner[c0]) this._cascade(c0, receiver);
        if (c1 !== -1 && this.cellSides[c1] >= 3 && !this.cellOwner[c1]) this._cascade(c1, receiver);
        return (sCT << 16) | sAT;
    }

    _cascade(cid, receiver) {
        this.capStk[this.capTop++] = cid;
        this.cellOwner[cid] = receiver;
        if (receiver === -1) this.scoreR++;
        else this.scoreY++;
        if (this.cellSides[cid] >= 2) this.riskCells--;

        const b = cid * 4;
        for (let s = 0; s < 4; s++) {
            const e = this.cEdges[b + s];
            if (!this.edges[e]) {
                this.autoStk[this.autoTop++] = e;
                this.edges[e] = 1;
                this.movesLeft--;
                const a0 = this.eAdj[e * 2];
                const a1 = this.eAdj[e * 2 + 1];
                if (a0 !== -1) this._inc(a0);
                if (a1 !== -1) this._inc(a1);
                if (a0 !== -1 && a0 !== cid && this.cellSides[a0] >= 3 && !this.cellOwner[a0]) this._cascade(a0, receiver);
                if (a1 !== -1 && a1 !== cid && this.cellSides[a1] >= 3 && !this.cellOwner[a1]) this._cascade(a1, receiver);
                break;
            }
        }
    }

    unmakeMove(eid, saved, curPlayer) {
        const sCT = saved >> 16;
        const sAT = saved & 0xFFFF;
        const receiver = (curPlayer === -1) ? -2 : -1;

        while (this.autoTop > sAT) {
            const e = this.autoStk[--this.autoTop];
            this.edges[e] = 0;
            this.movesLeft++;
            const a0 = this.eAdj[e * 2];
            const a1 = this.eAdj[e * 2 + 1];
            if (a1 !== -1) this._dec(a1);
            if (a0 !== -1) this._dec(a0);
        }

        while (this.capTop > sCT) {
            const cid = this.capStk[--this.capTop];
            if (receiver === -1) this.scoreR--;
            else this.scoreY--;
            this.cellOwner[cid] = 0;
            if (this.cellSides[cid] >= 2) this.riskCells++;
        }

        this.edges[eid] = 0;
        this.movesLeft++;
        const c0 = this.eAdj[eid * 2];
        const c1 = this.eAdj[eid * 2 + 1];
        if (c1 !== -1) this._dec(c1);
        if (c0 !== -1) this._dec(c0);
    }

    _edgeRisk(eid) {
        const c0 = this.eAdj[eid * 2];
        const c1 = this.eAdj[eid * 2 + 1];
        let risk = 0;
        if (c0 !== -1 && !this.cellOwner[c0]) {
            if (this.cellSides[c0] >= 3) risk += 100;
            else if (this.cellSides[c0] === 2) risk += 30;
        }
        if (c1 !== -1 && !this.cellOwner[c1]) {
            if (this.cellSides[c1] >= 3) risk += 100;
            else if (this.cellSides[c1] === 2) risk += 30;
        }
        return risk;
    }

    _edgeShapeScore(eid) {
        const c0 = this.eAdj[eid * 2];
        const c1 = this.eAdj[eid * 2 + 1];
        let score = 0;
        if (c0 !== -1 && !this.cellOwner[c0]) score += this.cellSides[c0] * 12;
        if (c1 !== -1 && !this.cellOwner[c1]) score += this.cellSides[c1] * 12;

        const b = eid * 3;
        const r = this.act0[b];
        const c = this.act0[b + 1];
        if (r === 0 || c === 0 || r === this.N - 1 || c === this.N - 1) score += 3;
        return score;
    }

    _genMoves(lv) {
        const buf = this.buffers[lv];
        let sc = 0;
        let rc = 0;
        for (let e = 0; e < this.totalEdges; e++) {
            if (this.edges[e]) continue;
            if (this._edgeRisk(e) === 0) buf.safe[sc++] = e;
            else buf.risky[rc++] = e;
        }
        buf.sc = sc;
        buf.rc = rc;
    }

    _scoreMove(eid, curPlayer) {
        const beforeMy = (curPlayer === -1) ? this.scoreR : this.scoreY;
        const beforeOpp = (curPlayer === -1) ? this.scoreY : this.scoreR;
        const beforeRisk = this.riskCells;
        const sv = this.makeMove(eid, curPlayer);
        const afterMy = (curPlayer === -1) ? this.scoreR : this.scoreY;
        const afterOpp = (curPlayer === -1) ? this.scoreY : this.scoreR;
        const score = (afterMy - beforeMy) * 14000 -
            (afterOpp - beforeOpp) * 16000 -
            (this.riskCells - beforeRisk) * 28 +
            this._edgeShapeScore(eid);
        this.unmakeMove(eid, sv, curPlayer);
        return score;
    }

    _collectRoot(buf) {
        let count = 0;
        const source = buf.sc > 0 ? buf.safe : buf.risky;
        const total = buf.sc > 0 ? buf.sc : buf.rc;
        const limit = buf.sc > 0 ? Math.min(total, this.SAFE_LIMIT) : Math.min(total, this.FORCED_LIMIT);

        for (let i = 0; i < total; i++) {
            const e = source[i];
            const score = this._scoreMove(e, this.myPly) - this._edgeRisk(e) * 500;
            let pos = count;
            if (count < limit) {
                count++;
            } else if (score <= this.rootScore[count - 1]) {
                continue;
            } else {
                pos = count - 1;
            }
            while (pos > 0 && score > this.rootScore[pos - 1]) {
                this.root[pos] = this.root[pos - 1];
                this.rootScore[pos] = this.rootScore[pos - 1];
                pos--;
            }
            this.root[pos] = e;
            this.rootScore[pos] = score;
        }
        return count;
    }

    evaluate(curPlayer) {
        const my = (curPlayer === -1) ? this.scoreR : this.scoreY;
        const opp = (curPlayer === -1) ? this.scoreY : this.scoreR;
        return (my - opp) * 12000 - this.riskCells * 18 + this.movesLeft;
    }

    _timeBudget(time) {
        if (time <= 120) return 3;
        const turns = Math.max((this.movesLeft / 2) | 0, 1);
        const phase = 1 - this.movesLeft / Math.max(this.totalPlayable, 1);
        let budget = time / (turns + 4);
        if (phase > 0.65) budget *= 1.8;
        else if (phase > 0.35) budget *= 1.25;
        else budget *= 0.75;
        budget = Math.min(budget, time * 0.18, 260);
        budget = Math.min(budget, time - 80);
        return Math.max(3, budget | 0);
    }

    negamax(depth, alpha, beta, curPlayer, lv) {
        if ((++this.nodeCnt & 0x3FF) === 0 && Date.now() - this.tStart >= this.tLimit) {
            this.timeUp = true;
            return 0;
        }
        if (this.timeUp) return 0;
        if (depth <= 0 || this.movesLeft === 0) return this.evaluate(curPlayer);

        this._genMoves(lv);
        const buf = this.buffers[lv];
        const total = buf.sc + buf.rc;
        if (total === 0) return this.evaluate(curPlayer);

        const opp = (curPlayer === -1) ? -2 : -1;
        const first = buf.sc > 0 ? buf.safe : buf.risky;
        const firstCount = buf.sc > 0 ? buf.sc : buf.rc;
        const limit = Math.min(firstCount, buf.sc > 0 ? 28 : 16);
        let best = -100000000;

        for (let i = 0; i < limit; i++) {
            const e = first[i];
            const sv = this.makeMove(e, curPlayer);
            const score = -this.negamax(depth - 1, -beta, -alpha, opp, lv + 1);
            this.unmakeMove(e, sv, curPlayer);
            if (this.timeUp) return 0;
            if (score > best) best = score;
            if (score > alpha) alpha = score;
            if (alpha >= beta) break;
        }
        return best;
    }

    _toAction(eid, board) {
        const b = eid * 3;
        let r = this.act0[b];
        let c = this.act0[b + 1];
        let s = this.act0[b + 2];
        if (r >= 0 && board[r][c] >= 0) return [r, c, s];
        r = this.act1[b];
        c = this.act1[b + 1];
        s = this.act1[b + 2];
        if (r >= 0 && board[r][c] >= 0) return [r, c, s];
        return [this.act0[b], this.act0[b + 1], this.act0[b + 2]];
    }

    compute(board, time) {
        this.syncFromBoard(board);
        if (this.movesLeft === 0) return [0, 0, 0];

        this._genMoves(0);
        const buf = this.buffers[0];
        const total = buf.sc + buf.rc;
        if (total === 0) return [0, 0, 0];
        if (total === 1) return this._toAction(buf.sc ? buf.safe[0] : buf.risky[0], board);

        const rootCount = this._collectRoot(buf);
        let bestMove = this.root[0];
        if (time <= 120 || rootCount <= 1) return this._toAction(bestMove, board);

        this.tStart = Date.now();
        this.tLimit = this._timeBudget(time);
        this.timeUp = false;

        const maxDepth = buf.sc > 0 ? 6 : 8;
        for (let depth = 1; depth <= maxDepth; depth++) {
            this.nodeCnt = 0;
            let bestScore = -100000000;
            let bestHere = bestMove;
            let alpha = -100000000;
            const beta = 100000000;

            for (let i = 0; i < rootCount; i++) {
                const e = this.root[i];
                const sv = this.makeMove(e, this.myPly);
                const score = -this.negamax(depth - 1, -beta, -alpha, this.oppPly, 1);
                this.unmakeMove(e, sv, this.myPly);
                if (this.timeUp) break;
                if (score > bestScore) {
                    bestScore = score;
                    bestHere = e;
                }
                if (score > alpha) alpha = score;
            }

            if (this.timeUp) break;
            bestMove = bestHere;
            if (Date.now() - this.tStart >= this.tLimit * 0.78) break;
            if (depth >= this.movesLeft) break;
        }

        return this._toAction(bestMove, board);
    }
}

class MyPlayer extends Agent {
    constructor() {
        super();
        this.boardObj = new Board();
    }


    init(color, board, time) {
        super.init(color, board, time);
        this.me = (color == 'R') ? -1 : -2;
        this.enemy = (this.me == -1) ? -2 : -1;
    }


    compute(board, time) {
        const moves = this.boardObj.valid_moves(board);
        const size = board.length;


        if (time < 500) return moves[0];


        let bestCapture = null;
        let safeMoves = [];
        let doubleEdges = [];
        for (let i = 0; i < moves.length; i++) {
            let mv = moves[i];
            let r = mv[0], c = mv[1], s = mv[2];
           
            if (this.countSides(board[r][c]) === 3) {
                return mv;
            }
           
            if (this.closesNeighbor(board, r, c, s)) return mv;


            if (this.isSafe(board, r, c, s)) {
                if (r === 0 || r === size-1 || c === 0 || c === size-1) {
                    safeMoves.unshift(mv);
                } else {
                    safeMoves.push(mv);
                }
            }
        }


        if (safeMoves.length > 0) {
            return safeMoves[0];
        }
        return this.quickLeastDangerous(board, moves.slice(0, 50));
    }


    closesNeighbor(board, r, c, s) {
        let nr = r, nc = c;
        if (s === 0) nr--;
        else if (s === 1) nc++;
        else if (s === 2) nr++;
        else if (s === 3) nc--;


        if (nr >= 0 && nr < board.length && nc >= 0 && nc < board.length) {
            if (this.countSides(board[nr][nc]) === 3) return true;
        }
        return false;
    }


    isSafe(board, r, c, s) {
        if (this.countSides(board[r][c]) >= 2) return false;
       
        let nr = r, nc = c;
        if (s === 0) nr--;
        else if (s === 1) nc++;
        else if (s === 2) nr++;
        else if (s === 3) nc--;


        if (nr >= 0 && nr < board.length && nc >= 0 && nc < board.length) {
            if (this.countSides(board[nr][nc]) >= 2) return false;
        }
        return true;
    }


    quickLeastDangerous(board, sampleMoves) {
        let best = sampleMoves[0];
        let minPenalty = 100;


        for (let mv of sampleMoves) {
            let penalty = 0;
            if (this.countSides(board[mv[0]][mv[1]]) === 2) penalty++;
            if (penalty < minPenalty) {
                minPenalty = penalty;
                best = mv;
            }
            if (minPenalty === 0) break;
        }
        return best;
    }


    countSides(cell) {
        if (cell < 0) return 4;
        let count = 0;
        if (cell & 1) count++;
        if (cell & 2) count++;
        if (cell & 4) count++;
        if (cell & 8) count++;
        return count;
    }
}


class Gemini2Agent extends Agent {
    constructor() {
        super();
        this.boardObj = new Board();
    }


    init(color, board, time = 20000) {
        super.init(color, board, time);
        this.me = (color == 'R') ? -1 : -2;
        this.enemy = (this.me == -1) ? -2 : -1;
    }


    compute(board, time) {
        let moves = this.boardObj.valid_moves(board);


        if (time < 200) return moves[0];


        let captureMoves = this.getCaptureMoves(board, moves);
        if (captureMoves.length > 0) {
            return captureMoves[0];
        }


        let safeMoves = moves.filter(mv => {
            let clone = this.boardObj.clone(board);
            this.boardObj.move(clone, mv[0], mv[1], mv[2], this.me);
            return !this.givesBox(clone);
        });


        if (safeMoves.length > 0) {
            return this.pickBestSafeMove(board, safeMoves);
        }


        return this.leastDangerousMove(board, moves);
    }


    getCaptureMoves(board, moves) {
        return moves.filter(mv => {
            let cellSides = this.countSides(board[mv[0]][mv[1]]);
            if (cellSides === 3) return true;
           
            if (mv[2] === 0 && mv[0] > 0 && this.countSides(board[mv[0]-1][mv[1]]) === 3) return true;
            if (mv[2] === 1 && mv[1] < board.length - 1 && this.countSides(board[mv[0]][mv[1]+1]) === 3) return true;
            if (mv[2] === 2 && mv[0] < board.length - 1 && this.countSides(board[mv[0]+1][mv[1]]) === 3) return true;
            if (mv[2] === 3 && mv[1] > 0 && this.countSides(board[mv[0]][mv[1]-1]) === 3) return true;
           
            return false;
        });
    }


    pickBestSafeMove(board, safeMoves) {
        return safeMoves.sort((a, b) => {
            let sidesA = this.countSides(board[a[0]][a[1]]);
            let sidesB = this.countSides(board[b[0]][b[1]]);
            return sidesA - sidesB; // Prefiere menos lados ocupados
        })[0];
    }


    givesBox(board) {
        for (let i = 0; i < board.length; i++) {
            for (let j = 0; j < board.length; j++) {
                if (board[i][j] >= 0 && this.countSides(board[i][j]) === 3) return true;
            }
        }
        return false;
    }


    leastDangerousMove(board, moves) {
        let bestMove = moves[0];
        let minThreeSided = Infinity;


        for (let mv of moves) {
            let clone = this.boardObj.clone(board);
            this.boardObj.move(clone, mv[0], mv[1], mv[2], this.me);
            let count = 0;
            for (let i = 0; i < clone.length; i++) {
                for (let j = 0; j < clone.length; j++) {
                    if (clone[i][j] >= 0 && this.countSides(clone[i][j]) === 3) count++;
                }
            }
            if (count < minThreeSided) {
                minThreeSided = count;
                bestMove = mv;
            }
        }
        return bestMove;
    }


    countSides(cell) {
        if (cell < 0) return 4
        let count = 0;
        if (cell & 1) count++;
        if (cell & 2) count++;
        if (cell & 4) count++;
        if (cell & 8) count++;
        return count;
    }
}

class ChatAgent extends Agent {

    constructor() {
        super();

        this.boardObj = new Board();

        this.SIDE_COUNT = [
            0,1,1,2,
            1,2,2,3,
            1,2,2,3,
            2,3,3,4
        ];
    }

    init(color, board, time=20000) {
        super.init(color, board, time);

        this.me = (color === 'R') ? -1 : -2;
        this.enemy = (this.me === -1) ? -2 : -1;

        this.maxDepth = 2;
    }

    compute(board, time) {

        this.turnStart = Date.now();

        const moves = this.boardObj.valid_moves(board);

        if(moves.length === 0)
            return [0,0,0];

        // Emergency fast mode
        if(time < 500)
            return moves[0];

        // =====================================================
        // 1. CAPTURES FIRST
        // =====================================================

        const captures = this.getCaptureMoves(board, moves);

        if(captures.length > 0)
            return captures[0];

        // =====================================================
        // 2. SAFE MOVES
        // =====================================================

        const safeMoves = [];

        for(let mv of moves){
            if(this.isSafeMove(board, mv))
                safeMoves.push(mv);
        }

        // =====================================================
        // EARLY / MID GAME
        // =====================================================

        // IMPORTANT:
        // Avoid minimax in large branching states

        if(safeMoves.length > 0 || moves.length > 80){

            const candidates =
                safeMoves.length > 0 ? safeMoves : moves;

            return this.bestHeuristicMove(board, candidates);
        }

        // =====================================================
        // ENDGAME SEARCH
        // =====================================================

        return this.searchBestMove(board, moves, time);
    }

    // =========================================================
    // BASIC UTILITIES
    // =========================================================

    countSides(cell){
        if(cell < 0) return 4;
        return this.SIDE_COUNT[cell & 15];
    }

    inBounds(board, r, c){
        return (
            r >= 0 &&
            r < board.length &&
            c >= 0 &&
            c < board.length
        );
    }

    neighbor(r, c, s){

        if(s === 0) return [r-1, c];
        if(s === 1) return [r, c+1];
        if(s === 2) return [r+1, c];
        return [r, c-1];
    }

    // =========================================================
    // CAPTURE DETECTION
    // =========================================================

    getCaptureMoves(board, moves){

        const captures = [];

        for(let mv of moves){

            const [r,c,s] = mv;

            if(this.countSides(board[r][c]) === 3){
                captures.push(mv);
                continue;
            }

            const [nr,nc] = this.neighbor(r,c,s);

            if(
                this.inBounds(board,nr,nc) &&
                this.countSides(board[nr][nc]) === 3
            ){
                captures.push(mv);
            }
        }

        return captures;
    }

    // =========================================================
    // SAFE MOVES
    // =========================================================

    isSafeMove(board, mv){

        const [r,c,s] = mv;

        if(this.countSides(board[r][c]) >= 2)
            return false;

        const [nr,nc] = this.neighbor(r,c,s);

        if(
            this.inBounds(board,nr,nc) &&
            this.countSides(board[nr][nc]) >= 2
        ){
            return false;
        }

        return true;
    }

    // =========================================================
    // HEURISTIC MOVE
    // =========================================================

    bestHeuristicMove(board, moves){

        let best = moves[0];
        let bestScore = -Infinity;

        for(let mv of moves){

            let score = this.evaluateMove(board, mv);

            if(score > bestScore){
                bestScore = score;
                best = mv;
            }
        }

        return best;
    }

    evaluateMove(board, mv){

        const [r,c,s] = mv;

        let score = 0;

        const sides = this.countSides(board[r][c]);

        // Prefer low-risk cells
        score -= sides * 5;

        // Slight border preference
        if(
            r === 0 ||
            c === 0 ||
            r === board.length-1 ||
            c === board.length-1
        ){
            score += 2;
        }

        // Avoid creating future chains
        const [nr,nc] = this.neighbor(r,c,s);

        if(this.inBounds(board,nr,nc)){

            const nsides =
                this.countSides(board[nr][nc]);

            score -= nsides * 3;
        }

        // Small randomness to avoid repetitive play
        score += Math.random();

        return score;
    }

    // =========================================================
    // LIMITED SEARCH
    // =========================================================

    searchBestMove(board, moves, time){

        // STRICT TIME CONTROL

        let depth = 2;

        if(time < 3000)
            depth = 1;

        // ORDER MOVES

        moves.sort((a,b)=>{
            return this.movePriority(board,b) -
                   this.movePriority(board,a);
        });

        // VERY IMPORTANT:
        // LIMIT BRANCHING FACTOR

        moves = moves.slice(0, 6);

        let bestMove = moves[0];
        let bestValue = -Infinity;

        for(let mv of moves){

            // TIME SAFETY

            if(Date.now() - this.turnStart > 150)
                break;

            const clone =
                this.boardObj.clone(board);

            this.boardObj.move(
                clone,
                mv[0],
                mv[1],
                mv[2],
                this.me
            );

            const value = this.minimax(
                clone,
                depth-1,
                false,
                -Infinity,
                Infinity
            );

            if(value > bestValue){
                bestValue = value;
                bestMove = mv;
            }
        }

        return bestMove;
    }

    movePriority(board, mv){

        const [r,c] = mv;

        const sides =
            this.countSides(board[r][c]);

        if(sides === 3) return 100;
        if(sides === 2) return -20;

        return 0;
    }

    minimax(board, depth, maximizing, alpha, beta){

        // HARD TIME LIMIT

        if(Date.now() - this.turnStart > 150)
            return this.evaluateBoard(board);

        if(depth <= 0)
            return this.evaluateBoard(board);

        let moves =
            this.boardObj.valid_moves(board);

        if(moves.length === 0)
            return this.evaluateBoard(board);

        // LIMIT BRANCHING

        moves.sort((a,b)=>{
            return this.movePriority(board,b) -
                   this.movePriority(board,a);
        });

        moves = moves.slice(0, 4);

        if(maximizing){

            let value = -Infinity;

            for(let mv of moves){

                const clone =
                    this.boardObj.clone(board);

                this.boardObj.move(
                    clone,
                    mv[0],
                    mv[1],
                    mv[2],
                    this.me
                );

                value = Math.max(
                    value,
                    this.minimax(
                        clone,
                        depth-1,
                        false,
                        alpha,
                        beta
                    )
                );

                alpha = Math.max(alpha, value);

                if(beta <= alpha)
                    break;
            }

            return value;

        }else{

            let value = Infinity;

            for(let mv of moves){

                const clone =
                    this.boardObj.clone(board);

                this.boardObj.move(
                    clone,
                    mv[0],
                    mv[1],
                    mv[2],
                    this.enemy
                );

                value = Math.min(
                    value,
                    this.minimax(
                        clone,
                        depth-1,
                        true,
                        alpha,
                        beta
                    )
                );

                beta = Math.min(beta, value);

                if(beta <= alpha)
                    break;
            }

            return value;
        }
    }

    // =========================================================
    // BOARD EVALUATION
    // =========================================================

    evaluateBoard(board){

        let score = 0;

        let myBoxes = 0;
        let enemyBoxes = 0;

        let threeSides = 0;
        let safeCells = 0;

        for(let i=0;i<board.length;i++){

            for(let j=0;j<board.length;j++){

                const cell = board[i][j];

                if(cell === this.me){
                    myBoxes++;
                    continue;
                }

                if(cell === this.enemy){
                    enemyBoxes++;
                    continue;
                }

                if(cell >= 0){

                    const sides =
                        this.countSides(cell);

                    if(sides === 3)
                        threeSides++;

                    if(sides <= 1)
                        safeCells++;
                }
            }
        }

        score += myBoxes * 200;
        score -= enemyBoxes * 200;

        score -= threeSides * 10;

        score += safeCells * 2;

        return score;
    }
}

