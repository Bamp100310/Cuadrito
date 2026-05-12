/*
 * Agente Chiminigagua (Optimizado V2)
 * Alto rendimiento para tableros grandes (NxN) con control estricto de tiempo global.
 */
class Chiminigagua extends Agent {

    constructor() {
        super();
        this.boardUtil = new Board();
    }

    init(color, board, time = 20000) {
        super.init(color, board, time);
        this.myCode = (color === 'R') ? -1 : -2;
        this.oppCode = (color === 'R') ? -2 : -1;
    }

    compute(board, time) {
        let startTime = Date.now();
        let moves = this.boardUtil.valid_moves(board);

        if(moves.length === 0) return [0,0,0];

        let captures = [];
        let safeMoves = [];

        // 1. FILTRAR Y CLASIFICAR MOVIMIENTOS EN O(1) SIN CLONAR TABLEROS
        for(let m of moves) {
            if(this.isCaptureMove(board, m)) {
                captures.push(m);
            } else if(!this.isDangerousMove(board, m)) {
                safeMoves.push(m);
            }
        }

        // 2. ¡REGLA DE ORO!: Si hay una captura, tómala inmediatamente. 
        // Esto ahorra el 90% del tiempo de procesamiento y asegura puntos.
        if(captures.length > 0) {
            return captures[0];
        }

        let candidates = safeMoves.length > 0 ? safeMoves : moves;

        // 3. PRESUPUESTO DE TIEMPO DINÁMICO
        // Repartimos el tiempo restante asumiendo ~20 movimientos nuestros más.
        let timeBudget = Math.floor(time / 20); 
        if(timeBudget > 800) timeBudget = 800; // Máximo 800ms por turno para estar seguros
        if(timeBudget < 30) timeBudget = 30;   // Mínimo 30ms

        // Si el tiempo es crítico de verdad, juega rápido (aleatorio seguro)
        if(time < 500) {
            return candidates[Math.floor(Math.random() * candidates.length)];
        }

        // 4. ORDENAR MOVIMIENTOS (Clonando solo UNA vez por candidato)
        let scored = candidates.map(m => {
            let temp = this.boardUtil.clone(board);
            this.boardUtil.move(temp, m[0], m[1], m[2], this.myCode);
            return { move: m, score: this.evaluate(temp) };
        });

        scored.sort((a, b) => b.score - a.score);
        candidates = scored.map(s => s.move);

        // 5. MINIMAX CONTROLADO POR TIEMPO
        let bestMove = candidates[0];
        let bestScore = -Infinity;
        let alpha = -Infinity;
        let beta = Infinity;

        // Profundidad ajustada para evitar explosión combinatoria
        let depth = (candidates.length <= 8) ? 3 : 2;
        let limit = Math.min(candidates.length, 8); 

        for(let k = 0; k < limit; k++) {
            // SALVAVIDAS: Si nos pasamos del presupuesto, cortamos aquí.
            if(Date.now() - startTime > timeBudget) break;

            let move = candidates[k];
            let nextBoard = this.boardUtil.clone(board);
            
            // Saber si capturamos sin contar todo el tablero
            let isCap = this.isCaptureMove(nextBoard, move);
            this.boardUtil.move(nextBoard, move[0], move[1], move[2], this.myCode);

            let score;
            if(isCap) {
                // Sigue siendo nuestro turno
                score = this.maxValue(nextBoard, depth - 1, alpha, beta, startTime, timeBudget);
            } else {
                // Turno del rival
                score = this.minValue(nextBoard, depth - 1, alpha, beta, startTime, timeBudget);
            }

            if(score > bestScore) {
                bestScore = score;
                bestMove = move;
            }

            alpha = Math.max(alpha, bestScore);
        }

        return bestMove;
    }

    maxValue(board, depth, alpha, beta, startTime, timeBudget) {
        if(depth === 0 || Date.now() - startTime > timeBudget) return this.evaluate(board);

        let moves = this.boardUtil.valid_moves(board);
        if(moves.length === 0) return this.evaluate(board);

        let value = -Infinity;

        for(let move of moves) {
            if(Date.now() - startTime > timeBudget) break;

            let nextBoard = this.boardUtil.clone(board);
            let isCap = this.isCaptureMove(nextBoard, move);
            this.boardUtil.move(nextBoard, move[0], move[1], move[2], this.myCode);

            let score;
            if(isCap) {
                score = this.maxValue(nextBoard, depth - 1, alpha, beta, startTime, timeBudget);
            } else {
                score = this.minValue(nextBoard, depth - 1, alpha, beta, startTime, timeBudget);
            }

            value = Math.max(value, score);
            if(value >= beta) return value;
            alpha = Math.max(alpha, value);
        }
        return value;
    }

    minValue(board, depth, alpha, beta, startTime, timeBudget) {
        if(depth === 0 || Date.now() - startTime > timeBudget) return this.evaluate(board);

        let moves = this.boardUtil.valid_moves(board);
        if(moves.length === 0) return this.evaluate(board);

        let value = Infinity;

        for(let move of moves) {
            if(Date.now() - startTime > timeBudget) break;

            let nextBoard = this.boardUtil.clone(board);
            let isCap = this.isCaptureMove(nextBoard, move);
            this.boardUtil.move(nextBoard, move[0], move[1], move[2], this.oppCode);

            let score;
            if(isCap) {
                score = this.minValue(nextBoard, depth - 1, alpha, beta, startTime, timeBudget);
            } else {
                score = this.maxValue(nextBoard, depth - 1, alpha, beta, startTime, timeBudget);
            }

            value = Math.min(value, score);
            if(value <= alpha) return value;
            beta = Math.min(beta, value);
        }
        return value;
    }

    // --- FUNCIONES MATEMÁTICAS O(1) PARA REEMPLAZAR CLONES PESADOS ---

    isCaptureMove(board, move) {
        let r = move[0], c = move[1], s = move[2];
        if (this.countSides(board[r][c]) === 3) return true;
        // Revisar casilla adyacente según el lado (0:arriba, 1:derecha, 2:abajo, 3:izquierda)
        if (s === 0 && r > 0 && this.countSides(board[r-1][c]) === 3) return true;
        if (s === 2 && r < board.length-1 && this.countSides(board[r+1][c]) === 3) return true;
        if (s === 3 && c > 0 && this.countSides(board[r][c-1]) === 3) return true;
        if (s === 1 && c < board.length-1 && this.countSides(board[r][c+1]) === 3) return true;
        return false;
    }

    isDangerousMove(board, move) {
        let r = move[0], c = move[1], s = move[2];
        if (this.countSides(board[r][c]) === 2) return true; // Cierra a 3 lados
        // Revisar vecina
        if (s === 0 && r > 0 && this.countSides(board[r-1][c]) === 2) return true;
        if (s === 2 && r < board.length-1 && this.countSides(board[r+1][c]) === 2) return true;
        if (s === 3 && c > 0 && this.countSides(board[r][c-1]) === 2) return true;
        if (s === 1 && c < board.length-1 && this.countSides(board[r][c+1]) === 2) return true;
        return false;
    }

    countSides(cell) {
        if (cell < 0) return 4; // Ya es una caja cerrada de algún jugador
        return (
            ((cell & 1) ? 1 : 0) +
            ((cell & 2) ? 1 : 0) +
            ((cell & 4) ? 1 : 0) +
            ((cell & 8) ? 1 : 0)
        );
    }

    // --- EVALUACIÓN REAGRUPADA A 1 SOLA PASADA O(N^2) ---

    evaluate(board) {
        let size = board.length;
        let myBoxes = 0, oppBoxes = 0;
        let chains = 0, safeCells = 0;

        for(let i=0; i<size; i++) {
            for(let j=0; j<size; j++) {
                let cell = board[i][j];
                if(cell === this.myCode) {
                    myBoxes++;
                } else if(cell === this.oppCode) {
                    oppBoxes++;
                } else if(cell >= 0) {
                    let sides = this.countSides(cell);
                    if(sides === 3) chains++;
                    if(sides <= 1) safeCells++;
                }
            }
        }

        let score = 0;
        score += (myBoxes - oppBoxes) * 100;
        score -= (chains * 40);
        score += (safeCells * 2);

        return score;
    }
}
