# 🎮 Agente Cuadrito - Grupo Chiminigagua
Proyecto final de Sistemas Inteligentes — Agente autónomo que juega **Cuadrito** (Dots and Boxes) usando un motor de búsqueda Minimax con poda Alfa-Beta, representación plana de alto rendimiento en arreglos tipados (`Uint8Array`), y profundización iterativa con gestión dinámica del tiempo.

El agente hereda de la clase `Agent` del ambiente y sobreescribe el método `compute(board, time)` para devolver la jugada óptima en formato `[fila, columna, lado]`. Internamente traduce la matriz NxN a una representación plana de aristas para ejecutar búsquedas a la mayor profundidad posible dentro del límite de tiempo.

**Récord Actual:** Victoria consistente contra agentes aleatorios en tableros de hasta 6×6 con 20 segundos de tiempo total.

---

## 👥 Equipo de Desarrollo
- **Nicolás Pájaro Sánchez**
- **Juan Camilo López Bustos**
- **Brayan Alejandro Muñoz Pérez**

---

## ⚙️ Reglas del Juego (según el ambiente)
Este **no** es un Dots and Boxes estándar. El ambiente implementa una variante con reglas particulares que el agente descubrió por ingeniería inversa del código fuente:

| Mecánica | D&B Estándar | Cuadrito (Este Ambiente) |
|----------|-------------|--------------------------|
| Captura se activa con... | 4to lado dibujado | **3er lado dibujado** (valores 14,13,11,7) |
| ¿Quién se queda la celda? | Quien dibujó el último lado | **El OPONENTE** de quien dibujó el 3er lado |
| ¿Turno extra al capturar? | Sí | **No** — turnos estrictamente alternados |
| ¿Cascada? | No | **Sí** — el 4to lado se autodibuja y puede activar capturas vecinas |

**Implicación estratégica**: Hay que **evitar** dibujar el 3er lado de cualquier celda (le regalás la celda al oponente). La clave es forzar al rival a posiciones donde no le quede de otra más que activar capturas que te benefician a vos.

---

## 📋 Requisitos e Instalación
- Navegador web moderno (Chrome, Firefox, Edge)
- Conexión a internet (el ambiente carga la librería [Konekti](https://jgomezpe.github.io/konekti/) remotamente)
- No se requieren dependencias adicionales ni instalación

---

## 🚀 Uso
1. Abrir `index.html` en un navegador web.
2. Llenar los campos del formulario:
   - **Time (secs)**: Tiempo total por jugador en segundos (ej: `20`)
   - **Size**: Tamaño del tablero NxN (ej: `4`, `5`, `6`)
   - **Red**: Nombre del agente rojo (ej: `smart`, `rand1`)
   - **Yellow**: Nombre del agente amarillo (ej: `rand1`, `smart`)
3. Hacer clic en el botón ▶ Play.
4. Observar la partida. El resultado aparece en el banner superior.

### Agentes disponibles:
| Nombre | Descripción |
|--------|-------------|
| `smart` | SmartAgent — Motor Minimax con poda α-β |
| `rand1` | Jugador aleatorio #1 |
| `rand2` | Jugador aleatorio #2 |

---

## 🏗️ Arquitectura del Sistema
```
Cuadrito/
├── index.html          # Interfaz web, registra los agentes y lanza el juego
├── squares.js          # Ambiente de juego (INTOCABLE, proporcionado por el profesor)
└── smartagente.js      # Motor de IA: Minimax + α-β + profundización iterativa
```

---

## 🧠 Algoritmos y Optimizaciones

### Representación Plana con Arreglos Tipados
En lugar de operar directamente sobre la matriz NxN del ambiente (que crea objetos y presiona el Garbage Collector), el agente traduce todo a arreglos planos `Uint8Array` e `Int8Array`:

- **`edges[]`**: Estado de cada arista única del tablero (0=libre, 1=dibujada). Para un tablero NxN hay `2·N·(N+1)` aristas totales.
- **`cellSides[]`**: Cantidad de lados dibujados por celda (0 a 4). Actualizado incrementalmente.
- **`cellOwner[]`**: Dueño de cada celda (0=libre, -1=rojo, -2=amarillo).

Esto elimina la presión sobre el GC de JavaScript y permite que V8 optimice los accesos a memoria como accesos directos a registros de CPU.

### Mapeo de Aristas
Cada arista física única recibe un ID entero:
- **Horizontales**: `ID = fila × N + columna` (para `(N+1)×N` aristas)
- **Verticales**: `ID = offset_h + fila × (N+1) + columna` (para `N×(N+1)` aristas)

Tablas de adyacencia precalculadas en `init()` mapean cada arista a sus celdas vecinas y viceversa.

### Make/Unmake Incremental con Cascada
El corazón del motor. Cada movimiento se ejecuta y deshace en tiempo casi-constante:

1. **`makeMove()`**: Dibuja la arista, incrementa `cellSides` de las celdas adyacentes. Si alguna llega a 3 → activa cascada.
2. **`_cascade()`**: Captura la celda (asignándola al oponente), autodibuja el lado faltante, y revisa recursivamente si las celdas vecinas del lado autodibujado también llegan a 3.
3. **`unmakeMove()`**: Deshace todo en orden inverso usando pilas precalculadas (`capStk`, `autoStk`). Restaura `cellSides`, `cellOwner`, scores y `dangerCount` exactamente al estado anterior.

La variable `dangerCount` (celdas con exactamente 2 lados sin capturar) se mantiene incrementalmente en cada `_inc()` y `_dec()`, evitando recorrer el tablero en la evaluación.

### Negamax con Poda Alfa-Beta
Búsqueda estándar Negamax donde el valor retornado siempre es desde la perspectiva del jugador actual:
- Se exploran primero los movimientos **seguros** (que no regalan celdas) y después los **regalos** (que activan capturas para el oponente).
- Este ordenamiento de movimientos en dos niveles maximiza los cortes alfa-beta sin necesidad de ordenamiento costoso.
- Chequeo de tiempo cada 2048 nodos usando máscara de bits (`nodeCnt & 0x7FF`) para no llamar `Date.now()` en cada nodo.

### Profundización Iterativa con Reordenamiento de Raíz
```
depth=1 → depth=2 → depth=3 → ... → (se acabó el tiempo)
```
Después de cada iteración completa, el mejor movimiento encontrado se mueve al inicio de la lista para la siguiente iteración. Esto garantiza que la siguiente búsqueda más profunda empiece con la jugada más prometedora y logre cortes tempranos.

### Gestión Dinámica del Tiempo
Para evitar el timeout en tableros grandes, el agente calcula un presupuesto de tiempo por turno basado en:

```
base = tiempoRestante / (misMovimientosRestantes + 1)
```

Multiplicado por un factor de fase:
| Fase del juego | Multiplicador | Razón |
|----------------|---------------|-------|
| Apertura (<25%) | ×0.7 | Muchas ramas, poco impacto a largo plazo |
| Medio (25-55%) | ×1.0 | Balance |
| Tardío (55-80%) | ×1.5 | Las cadenas se forman, decisiones críticas |
| Final (>80%) | ×2.0 | Pocos movimientos, invertir el tiempo restante |

Con topes duros: nunca más del 30% del tiempo restante, y siempre reservar mínimo 150ms de colchón.

### Función de Evaluación
Evaluación incremental O(1) desde la perspectiva del jugador actual:
```
eval = (miScore - scoreOponente) × 10000 - dangerCount × 10
```
- La diferencia de puntaje es el factor dominante.
- `dangerCount` penaliza posiciones con muchas celdas en zona de peligro (2 lados), que indican mayor probabilidad de regalos forzados.

---

## 📊 Resultados de Pruebas

| Tablero | Oponente | Resultado | Score | Movimientos |
|---------|----------|-----------|-------|-------------|
| 4×4 | RandomPlayer | **Victoria (R)** | 11-5 | 10 |
| 6×6 | RandomPlayer | **Victoria (R)** | Consistente | ~30 |

---

## 🎓 Desarrollado en — Universidad Nacional de Colombia, Sede Bogotá
