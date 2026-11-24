export const params = {
 "flotacion": {
  "label": "Flotación",
  "type": "range",
  "value": 0.18,
  "min": 0,
  "max": 0.5,
  "step": 0.01,
  "unit": "u",
  "how": "Sube y baja con hold arriba y abajo: «casi quieto, pero vivo» (moving hold), no un columpio."
 },
 "periodo": {
  "label": "Ciclo de flotar",
  "type": "range",
  "value": 3.8,
  "min": 2,
  "max": 7,
  "step": 0.1,
  "unit": "s",
  "how": "Respiración de 3–5 s. Dormido lo alarga, alerta lo acorta."
 },
 "respiracion": {
  "label": "Respiración",
  "type": "range",
  "value": 0.02,
  "min": 0,
  "max": 0.06,
  "step": 0.005,
  "how": "Escala el alto y el ancho del cuerpo con área constante. Los radios no cambian: las esquinas siguen siendo círculos de 1u."
 },
 "cuerpo": {
  "label": "Resorte del cuerpo",
  "type": "spring",
  "k": 170,
  "z": 0.85,
  "how": "A dónde va la raíz. Casi crítico: un solo rebote chico como máximo."
 },
 "lobulos": {
  "label": "Resorte de los lóbulos",
  "type": "spring",
  "k": 120,
  "z": 0.75,
  "how": "Los lóbulos de abajo llegan tarde al cuerpo, enteros: overlap en tiempo, no en forma. Tope ¼u."
 },
 "brazos": {
  "label": "Resorte de los brazos",
  "type": "spring",
  "k": 220,
  "z": 0.85,
  "how": "Brazo rígido. Bounce ≈ 0.1 (Apple: 0.15 «no se siente bouncy»). Además llega 2 cuadros tarde al cuerpo."
 },
 "transiciones": {
  "label": "Transiciones de forma",
  "type": "choice",
  "value": "receta",
  "options": [
   "receta",
   "v3",
   "esp32"
  ],
  "how": "receta: la tabla de anim-20 (cada par de/a con su tween, anticipación o parpadeo). v3: todo escondido en un parpadeo. esp32: tween lineal de 500 ms (se siente lento). Para comparar en el laboratorio."
 },
 "ensanche": {
  "label": "Ensanche al parpadear",
  "type": "range",
  "value": 1.3,
  "min": 1,
  "max": 1.5,
  "step": 0.05,
  "unit": "×",
  "how": "Cozmo: al cerrar, el ojo se ensancha ×1.3–1.5 y los cortes y el domo van a 0. Sin ensanche el parpadeo se ve como un ojo que se encoge."
 },
 "dart": {
  "label": "Duración de los darts",
  "type": "range",
  "value": 1,
  "min": 0.5,
  "max": 3,
  "step": 0.1,
  "unit": "×",
  "how": "1×: 2–3 cuadros con el 80 % del recorrido en el primero; crece con la amplitud. Lentos = sueño."
 },
 "parpadeos": {
  "label": "Ritmo de parpadeo",
  "type": "range",
  "value": 1,
  "min": 0.5,
  "max": 2,
  "step": 0.1,
  "unit": "×",
  "how": "Multiplica la frecuencia de cada estado: esperando cada 2–4 s, pensando cada 7–11 s, leyendo cada 10–15 s."
 },
 "perspectiva": {
  "label": "Perspectiva barata",
  "type": "toggle",
  "value": true,
  "how": "esp32-eyes: el ojo del lado al que mira crece +20 % de alto y el otro baja −20 %. Da volumen sin pupilas."
 },
 "microsacadas": {
  "label": "Microsacadas (solo en grande)",
  "type": "toggle",
  "value": true,
  "how": "1–2 por segundo, ±0.05u. A tamaño real se apagan: no sobreviven al píxel."
 },
 "brillo": {
  "label": "Brillo (reflejo de la luz)",
  "type": "toggle",
  "value": true,
  "how": "El bloque oscuro ya es la pupila (como Kirby o el rubber hose). El cuadro claro es el reflejo de la luz: va en la misma esquina en los dos ojos, no en espejo, y es hijo del ojo."
 },
 "brillo_tam": {
  "label": "Tamaño del brillo",
  "type": "range",
  "value": 0.43,
  "min": 0.25,
  "max": 0.6,
  "step": 0.01,
  "unit": "u",
  "how": "0.43u = 6 px a 112 px. Tabla por tamaño: 2 px a 32, 1 px a 24, sin brillo a 16. «Escucha» y «terminó» lo crecen +25 % en ~1 s (ternura)."
 },
 "brillo_x": {
  "label": "Brillo: posición horizontal",
  "type": "range",
  "value": 0.3,
  "min": 0,
  "max": 1,
  "step": 0.05,
  "how": "Fracción de la caja del ojo. La misma en los dos ojos: la luz es una sola. Si cambia de esquina se lee bizco."
 },
 "brillo_y": {
  "label": "Brillo: posición vertical",
  "type": "range",
  "value": 0.2,
  "min": 0,
  "max": 1,
  "step": 0.05,
  "how": "Fracción de la altura libre bajo la ceja. En squash se mueve su lugar, no su tamaño."
 },
 "parallax": {
  "label": "Parallax en los darts (solo grande)",
  "type": "toggle",
  "value": true,
  "how": "Ojo y brillo se mueven en el mismo cuadro. En grande el brillo se queda ~15 % atrás y se asienta en 1–2 cuadros."
 },
 "vergencia": {
  "label": "Vergencia de cerca",
  "type": "toggle",
  "value": true,
  "how": "Con el puntero encima de su cara, los ojos se juntan ¼u (mira algo muy cerca)."
 },
 "ola": {
  "label": "Ola de los lóbulos",
  "type": "range",
  "value": 0.08,
  "min": 0,
  "max": 0.25,
  "step": 0.01,
  "unit": "u",
  "how": "Cada lóbulo sube y baja entero, desfasado del vecino. Tope ¼u."
 },
 "ola_periodo": {
  "label": "Ciclo de la ola",
  "type": "range",
  "value": 2.8,
  "min": 1.2,
  "max": 5,
  "step": 0.1,
  "unit": "s",
  "how": "Más lento = tela pesada; más rápido = nervioso. Va aparte del flote para que no marchen juntos."
 },
 "desfase": {
  "label": "Desfase entre lóbulos",
  "type": "range",
  "value": 0.6,
  "min": 0,
  "max": 1.6,
  "step": 0.05,
  "unit": "rad",
  "how": "Cuánto llega tarde cada lóbulo al vecino. Alto = 1-2-3 por separado (se lee como ticks); bajo = la orilla se mueve como una sola tela."
 },
 "exagerar": {
  "label": "Exageración",
  "type": "range",
  "value": 1,
  "min": 0.5,
  "max": 1.4,
  "step": 0.05,
  "unit": "×",
  "how": "Escala amplitudes de los gestos, no su tiempo. Los brazos nunca pasan de −55° / +30°."
 },
 "rayos": {
  "label": "Rayos X",
  "type": "toggle",
  "value": false,
  "how": "La mirada: de dónde salió el último dart y a dónde va."
 },
 "osc": {
  "label": "Osciloscopio",
  "type": "toggle",
  "value": true,
  "how": "Los últimos 5 s: altura, mirada x/y, alto del ojo y párpado. Ahí se ve el 80 % del dart en el primer cuadro."
 },
 "lod": {
  "label": "Tabla por tamaño en el notch",
  "type": "toggle",
  "value": true,
  "how": "Sí: a 32/24/16 px solo los canales que sobreviven, al píxel y a 12 fps. No: el mismo rig escalado, para comparar."
 },
 "caret_periodo": {
  "label": "Caret: medio ciclo",
  "type": "range",
  "value": 0.53,
  "min": 0.3,
  "max": 1.2,
  "step": 0.01,
  "unit": "s",
  "how": "Cuánto dura ▮ y cuánto ▁. 0.53 s es el cursor de terminal."
 },
 "caret_rampa": {
  "label": "Caret: rampa",
  "type": "range",
  "value": 0.07,
  "min": 0,
  "max": 0.3,
  "step": 0.01,
  "unit": "s",
  "how": "Cuánto tarda en pasar de ▮ a ▁ y de vuelta. 0 = el pop de v1."
 },
 "caret_color": {
  "label": "Caret: color",
  "type": "choice",
  "value": "ojo",
  "options": [
   "ojo",
   "cian"
  ],
  "how": "ojo: el caret va del color normal del ojo (la base). cian: el acento de «te necesita», que lo pone la capa de la isla o el notch, no el fantasma."
 }
}
;
export const P = { v: key => params[key].type === 'spring' ? params[key] : params[key].value };
