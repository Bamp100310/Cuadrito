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

