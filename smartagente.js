// Agente inteligente para Cuadrito
// Usa minimax con poda alfa-beta y búsqueda iterativa
// La representación interna es con arreglos planos para que sea rapido

class SmartAgent extends Agent {
    constructor() {
        super();
    }

    // Inicialización: precalcula tablas de adyacencia y reserva memoria
    init(color, board, time) {
        super.init(color, board, time);
        const N = this.size;
        this.N = N;

        // mi color en la representación del ambiente (-1=rojo, -2=amarillo)
        this.myPly = (color === 'R') ? -1 : -2;
        this.oppPly = (color === 'R') ? -2 : -1;

        // conteo de aristas
        // horizontales: (N+1) filas x N columnas
        // verticales: N filas x (N+1) columnas
        const hC = (N + 1) * N;
        const vC = N * (N + 1);
        this.totalEdges = hC + vC;
        this.hCount = hC;
        this.totalPlayable = 2 * N * (N - 1); // aristas que no son borde

        // arreglos de estado
        this.edges = new Uint8Array(this.totalEdges); // 0=libre, 1=dibujada
        this.cellSides = new Uint8Array(N * N); // lados dibujados por celda
        this.cellOwner = new Int8Array(N * N); // 0=libre, -1=rojo, -2=amarillo
        this.scoreR = 0;
        this.scoreY = 0;
        this.movesLeft = 0;
        this.dangerCount = 0; // celdas con exactamente 2 lados (peligrosas)

        // adyacencia: cada arista tiene max 2 celdas vecinas
        this.eAdj = new Int16Array(this.totalEdges * 2).fill(-1);

        // mapeo arista -> acción [fila, col, lado] (dos representaciones posibles)
        this.act0 = new Int8Array(this.totalEdges * 3).fill(-1);
        this.act1 = new Int8Array(this.totalEdges * 3).fill(-1);

        // celda -> sus 4 aristas [arriba, derecha, abajo, izquierda]
        this.cEdges = new Int16Array(N * N * 4);

        this._buildTables(N, hC);

        // pilas para deshacer cascadas de capturas
        const mx = N * N;
        this.capStk = new Int16Array(mx);
        this.autoStk = new Int16Array(mx);
        this.capTop = 0;
        this.autoTop = 0;

        // buffers de movimientos por nivel de profundidad
        const ML = 80;
        this._mb = new Array(ML);
        for (let d = 0; d < ML; d++) {
            this._mb[d] = {
                s: new Int16Array(this.totalEdges),
                g: new Int16Array(this.totalEdges),
                sc: 0, gc: 0
            };
        }

        // control de búsqueda
        this.nodeCnt = 0;
        this.timeUp = false;
        this.tStart = 0;
        this.tLimit = 0;
    }

    // construye las tablas de adyacencia y mapeo de acciones
    _buildTables(N, hC) {
        // aristas horizontales
        for (let eid = 0; eid < hC; eid++) {
            const r = (eid / N) | 0, c = eid % N;
            let k = 0;
            if (r < N) { // celda de abajo -> lado arriba
                this.eAdj[eid * 2 + k] = r * N + c;
                this._sa(k === 0 ? this.act0 : this.act1, eid, r, c, 0);
                k++;
            }
            if (r > 0) { // celda de arriba -> lado abajo
                this.eAdj[eid * 2 + k] = (r - 1) * N + c;
                this._sa(k === 0 ? this.act0 : this.act1, eid, r - 1, c, 2);
                k++;
            }
        }
        // aristas verticales
        const vC = N * (N + 1);
        for (let i = 0; i < vC; i++) {
            const eid = hC + i;
            const r = (i / (N + 1)) | 0, c = i % (N + 1);
            let k = 0;
            if (c < N) { // celda a la derecha -> lado izquierdo
                this.eAdj[eid * 2 + k] = r * N + c;
                this._sa(k === 0 ? this.act0 : this.act1, eid, r, c, 3);
                k++;
            }
            if (c > 0) { // celda a la izquierda -> lado derecho
                this.eAdj[eid * 2 + k] = r * N + (c - 1);
                this._sa(k === 0 ? this.act0 : this.act1, eid, r, c - 1, 1);
                k++;
            }
        }
        // mapeo celda -> aristas
        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                const b = (i * N + j) * 4;
                this.cEdges[b] = i * N + j; // arriba
                this.cEdges[b + 1] = hC + i * (N + 1) + j + 1; // derecha
                this.cEdges[b + 2] = (i + 1) * N + j; // abajo
                this.cEdges[b + 3] = hC + i * (N + 1) + j; // izquierda
            }
        }
    }

    _sa(arr, eid, r, c, s) {
        const b = eid * 3;
        arr[b] = r; arr[b+1] = c; arr[b+2] = s;
    }

    // traduce la matriz NxN del ambiente a la representación plana interna
    syncFromBoard(board) {
        const N = this.N, tot = N * N;
        this.edges.fill(0);
        this.cellSides.fill(0);
        this.cellOwner.fill(0);
        this.scoreR = 0; this.scoreY = 0;
        this.dangerCount = 0;
        this.capTop = 0; this.autoTop = 0;

        for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
                const cid = i * N + j, v = board[i][j], b = cid * 4;
                if (v < 0) {
                    // celda capturada: todas sus aristas estan dibujadas
                    this.cellOwner[cid] = v;
                    this.edges[this.cEdges[b]] = 1;
                    this.edges[this.cEdges[b+1]] = 1;
                    this.edges[this.cEdges[b+2]] = 1;
                    this.edges[this.cEdges[b+3]] = 1;
                    if (v === -1) this.scoreR++; else this.scoreY++;
                } else {
                    // leer bits de la mascara
                    if (v & 1) this.edges[this.cEdges[b]] = 1;
                    if (v & 2) this.edges[this.cEdges[b+1]] = 1;
                    if (v & 4) this.edges[this.cEdges[b+2]] = 1;
                    if (v & 8) this.edges[this.cEdges[b+3]] = 1;
                }
            }
        }

        // contar lados por celda y aristas libres
        this.movesLeft = 0;
        for (let cid = 0; cid < tot; cid++) {
            if (this.cellOwner[cid]) { this.cellSides[cid] = 4; continue; }
            const b = cid * 4;
            let cnt = 0;
            if (this.edges[this.cEdges[b]]) cnt++;
            if (this.edges[this.cEdges[b+1]]) cnt++;
            if (this.edges[this.cEdges[b+2]]) cnt++;
            if (this.edges[this.cEdges[b+3]]) cnt++;
            this.cellSides[cid] = cnt;
            if (cnt === 2) this.dangerCount++;
        }
        for (let e = 0; e < this.totalEdges; e++) {
            if (!this.edges[e]) this.movesLeft++;
        }
    }

    // actualización incremental de cellSides y dangerCount
    _inc(cid) {
        const old = this.cellSides[cid];
        this.cellSides[cid] = old + 1;
        if (!this.cellOwner[cid]) {
            if (old === 1) this.dangerCount++;
            else if (old === 2) this.dangerCount--;
        }
    }

    _dec(cid) {
        const old = this.cellSides[cid];
        this.cellSides[cid] = old - 1;
        if (!this.cellOwner[cid]) {
            if (old === 2) this.dangerCount--;
            else if (old === 3) this.dangerCount++;
        }
    }

    // dibuja una arista y ejecuta cascada de capturas si aplica
    // las capturas van al OPONENTE del jugador actual
    // retorna estado guardado para poder deshacer
    makeMove(eid, curPlayer) {
        const sCT = this.capTop, sAT = this.autoTop;
        const opp = (curPlayer === -1) ? -2 : -1;

        this.edges[eid] = 1;
        this.movesLeft--;

        const c0 = this.eAdj[eid * 2], c1 = this.eAdj[eid * 2 + 1];
        if (c0 !== -1) this._inc(c0);
        if (c1 !== -1) this._inc(c1);

        // captura cuando una celda llega a 3 lados
        if (c0 !== -1 && this.cellSides[c0] === 3 && !this.cellOwner[c0])
            this._cascade(c0, opp);
        if (c1 !== -1 && this.cellSides[c1] === 3 && !this.cellOwner[c1])
            this._cascade(c1, opp);

        return (sCT << 16) | sAT;
    }

    // cascada: captura la celda y autodibuja el lado faltante
    _cascade(cid, opp) {
        this.capStk[this.capTop++] = cid;
        this.cellOwner[cid] = opp;
        if (opp === -1) this.scoreR++; else this.scoreY++;

        // buscar el lado que falta (solo hay 1 cuando cellSides==3)
        const b = cid * 4;
        for (let s = 0; s < 4; s++) {
            const e = this.cEdges[b + s];
            if (!this.edges[e]) {
                this.autoStk[this.autoTop++] = e;
                this.edges[e] = 1;
                this.movesLeft--;

                const a0 = this.eAdj[e * 2], a1 = this.eAdj[e * 2 + 1];
                if (a0 !== -1) this._inc(a0);
                if (a1 !== -1) this._inc(a1);

                // revisar si la arista autodibujada genera mas capturas
                if (a0 !== -1 && a0 !== cid && this.cellSides[a0] === 3 && !this.cellOwner[a0])
                    this._cascade(a0, opp);
                if (a1 !== -1 && a1 !== cid && this.cellSides[a1] === 3 && !this.cellOwner[a1])
                    this._cascade(a1, opp);
                break;
            }
        }
    }

    // deshace un movimiento completo (incluyendo cascadas)
    unmakeMove(eid, saved, curPlayer) {
        const sCT = saved >> 16, sAT = saved & 0xFFFF;
        const opp = (curPlayer === -1) ? -2 : -1;

        // deshacer aristas autodibujadas (en reversa)
        while (this.autoTop > sAT) {
            const ae = this.autoStk[--this.autoTop];
            this.edges[ae] = 0;
            this.movesLeft++;
            const a0 = this.eAdj[ae * 2], a1 = this.eAdj[ae * 2 + 1];
            if (a1 !== -1) this._dec(a1);
            if (a0 !== -1) this._dec(a0);
        }
        // descapturar celdas
        while (this.capTop > sCT) {
            const cc = this.capStk[--this.capTop];
            if (opp === -1) this.scoreR--; else this.scoreY--;
            this.cellOwner[cc] = 0;
            if (this.cellSides[cc] === 2) this.dangerCount++;
        }
        // deshacer arista principal
        this.edges[eid] = 0;
        this.movesLeft++;
        const c0 = this.eAdj[eid * 2], c1 = this.eAdj[eid * 2 + 1];
        if (c1 !== -1) this._dec(c1);
        if (c0 !== -1) this._dec(c0);
    }

    // evaluación heuristica desde la perspectiva del jugador actual
    evaluate(curPlayer) {
        const my = (curPlayer === -1) ? this.scoreR : this.scoreY;
        const opp = (curPlayer === -1) ? this.scoreY : this.scoreR;
        return (my - opp) * 10000 - this.dangerCount * 10;
    }

    // genera movimientos en dos categorias:
    // "seguros" = no regalan celda, "regalo" = le dan celda al oponente
    _genMoves(lv) {
        const buf = this._mb[lv];
        let sc = 0, gc = 0;
        for (let e = 0; e < this.totalEdges; e++) {
            if (this.edges[e]) continue;
            const c0 = this.eAdj[e * 2], c1 = this.eAdj[e * 2 + 1];
            // es "regalo" si alguna celda adyacente tiene 2 lados (un lado mas = captura)
            if ((c0 !== -1 && this.cellSides[c0] === 2 && !this.cellOwner[c0]) ||
                (c1 !== -1 && this.cellSides[c1] === 2 && !this.cellOwner[c1])) {
                buf.g[gc++] = e;
            } else {
                buf.s[sc++] = e;
            }
        }
        buf.sc = sc; buf.gc = gc;
    }

    // negamax con poda alfa-beta
    negamax(depth, alpha, beta, curPlayer, lv) {
        // revisar tiempo cada 2048 nodos
        if ((++this.nodeCnt & 0x7FF) === 0) {
            if (Date.now() - this.tStart >= this.tLimit) { this.timeUp = true; return 0; }
        }
        if (this.timeUp) return 0;

        if (depth <= 0 || this.movesLeft === 0)
            return this.evaluate(curPlayer);

        this._genMoves(lv);
        const buf = this._mb[lv];
        const total = buf.sc + buf.gc;
        if (total === 0) return this.evaluate(curPlayer);

        const opp = (curPlayer === -1) ? -2 : -1;
        let best = -100000000;

        // explorar seguros primero para mejores cortes alfa-beta
        for (let pass = 0; pass < 2; pass++) {
            const arr = pass === 0 ? buf.s : buf.g;
            const cnt = pass === 0 ? buf.sc : buf.gc;
            for (let i = 0; i < cnt; i++) {
                const e = arr[i];
                const sv = this.makeMove(e, curPlayer);
                const sc = -this.negamax(depth - 1, -beta, -alpha, opp, lv + 1);
                this.unmakeMove(e, sv, curPlayer);
                if (this.timeUp) return 0;
                if (sc > best) best = sc;
                if (sc > alpha) alpha = sc;
                if (alpha >= beta) return best;
            }
        }
        return best;
    }

    // convierte ID de arista a [fila, columna, lado] para el ambiente
    _toAction(eid, board) {
        const b = eid * 3;
        let r = this.act0[b], c = this.act0[b+1], s = this.act0[b+2];
        if (r >= 0 && board[r][c] >= 0) return [r, c, s];
        r = this.act1[b]; c = this.act1[b+1]; s = this.act1[b+2];
        if (r >= 0 && board[r][c] >= 0) return [r, c, s];
        return [this.act0[b], this.act0[b+1], this.act0[b+2]];
    }

    // calcula cuanto tiempo gastar en este turno
    // se basa en la fase del juego y cuantos movimientos me quedan
    _allocTime(rem) {
        // estimar cuantos turnos me quedan (la mitad de los movimientos restantes)
        const myMovesLeft = Math.max(Math.ceil(this.movesLeft / 2), 1);
        // base: repartir equitativamente el tiempo restante
        const base = rem / (myMovesLeft + 1);

        // multiplicador segun fase del juego
        const phase = 1.0 - this.movesLeft / Math.max(this.totalPlayable, 1);
        let mult;
        if (phase < 0.25) mult = 0.7; // apertura: gastar poco
        else if (phase < 0.55) mult = 1.0; // medio juego
        else if (phase < 0.80) mult = 1.5; // juego tardio: las decisiones importan mas
        else mult = 2.0; // final: quedan pocos movimientos, invertir tiempo

        let t = base * mult;
        // nunca gastar mas del 30% del tiempo restante
        t = Math.min(t, rem * 0.30);
        // reservar minimo 150ms de colchon
        t = Math.min(t, rem - 150);
        // minimo 5ms para no devolver basura
        return Math.max(t, 5);
    }

    // metodo principal que llama el ambiente
    compute(board, time) {
        this.syncFromBoard(board);

        if (this.movesLeft === 0) return [0, 0, 0];

        // ver que movimientos hay
        this._genMoves(0);
        const buf0 = this._mb[0];
        const total = buf0.sc + buf0.gc;
        if (total === 0) return [0, 0, 0];

        // si solo hay un movimiento, jugarlo de una
        if (total === 1) {
            const e = buf0.sc > 0 ? buf0.s[0] : buf0.g[0];
            return this._toAction(e, board);
        }

        // si queda muy poco tiempo, jugar lo primero seguro
        if (time <= 100) {
            const e = buf0.sc > 0 ? buf0.s[0] : buf0.g[0];
            return this._toAction(e, board);
        }

        // armar lista de movimientos raiz (seguros primero)
        const rootMoves = [];
        for (let i = 0; i < buf0.sc; i++) rootMoves.push(buf0.s[i]);
        for (let i = 0; i < buf0.gc; i++) rootMoves.push(buf0.g[i]);

        this.tLimit = this._allocTime(time);
        this.tStart = Date.now();
        this.timeUp = false;

        let bestMove = rootMoves[0];

        // profundización iterativa
        for (let depth = 1; depth <= 60; depth++) {
            this.nodeCnt = 0;
            let bestScore = -100000000;
            let bestHere = rootMoves[0];
            let alpha = -100000000;
            const beta = 100000000;

            for (let i = 0; i < rootMoves.length; i++) {
                const e = rootMoves[i];
                const sv = this.makeMove(e, this.myPly);
                const sc = -this.negamax(depth - 1, -beta, -alpha, this.oppPly, 1);
                this.unmakeMove(e, sv, this.myPly);

                if (this.timeUp) break;

                if (sc > bestScore) {
                    bestScore = sc;
                    bestHere = e;
                }
                if (sc > alpha) alpha = sc;
            }

            if (!this.timeUp) {
                bestMove = bestHere;
                // poner el mejor movimiento primero para la siguiente iteración
                const idx = rootMoves.indexOf(bestHere);
                if (idx > 0) {
                    rootMoves.splice(idx, 1);
                    rootMoves.unshift(bestHere);
                }
            }

            if (Date.now() - this.tStart >= this.tLimit * 0.80) break;
            if (depth >= this.movesLeft) break;
        }

        return this._toAction(bestMove, board);
    }
}
