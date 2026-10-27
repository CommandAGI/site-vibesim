// The three home pages from one template and one strings table, so the locales never drift apart. The output is
// plain static HTML, committed. Run: node tools/pages.mjs  (writes index.html, es/index.html, zh-Hans/index.html)
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const LOCALES = {
    en: {
        file: 'index.html', base: '', self: '/',
        title: 'VibeSim — simulation by description',
        description: 'VibeSim runs a simulation from a short written description. Type a sentence and a swarm becomes it; write a scene and a servo-driven arm runs it, in your browser.',
        skip: 'Skip to the lab', nav: 'Main', phases: 'Phases of a run',
        verbs: ['describe', 'instantiate', 'simulate', 'inspect'], docs: 'Docs', lab: 'Lab',
        h1: ['Describe it.', 'It runs.'],
        lede: 'VibeSim turns a few written words into a running system. Rewrite the sentence below and the swarm behind this text is rebuilt from it.',
        sentenceLabel: 'Describe the swarm', sentence: "1600 boids, scared of the cursor, slow, warm",
        instantiate: 'Instantiate', understoodLabel: 'Understood', agents: 'agents', phi: 'order φ',
        swarmNote: 'A word parser reads one number and a short list of words. It is not a language model.',
        swarmStep: 'Step', swarmAria: 'A boids swarm, simulated in this tab from the sentence',
        tags: { slow: 'slow', fast: 'fast', 'fears the cursor': 'fears the cursor', 'follows the cursor': 'follows the cursor', warm: 'warm', cold: 'cold', tight: 'tight', loose: 'loose', wind: 'wind', swirl: 'swirl', '(nothing)': 'no word I know: the defaults' },
        verbsTitle: 'Four verbs, one run',
        verbsText: [
            'One JSON object: the machine, where each joint starts, the point to reach, the load.',
            'The SO-101 is built from its published joint ranges. Each arc is a joint’s whole range.',
            'Inverse kinematics finds the angles; each servo is stepped at one kilohertz until the arm settles.',
            'Every joint’s angle over time, inside its band. A trace at the band’s edge is a joint at its limit.',
        ],
        verbsArm: 'The pick-and-place run, drawn at the scroll’s position', verbsTraces: 'The six joints’ angles over the run',
        labTitle: 'The bench', labLede: 'Write the scene. Run it. Read what the servos did.',
        stageAria: 'The simulated arm, drawn from the description', hud: 'Home pose.',
        presetsAria: 'Example descriptions', presets: ['Reach', 'Pick and place', 'Out of reach'],
        sceneLabel: 'The description', sceneHelp: 'Aim the tool point (millimetres), say what the gripper holds, and the servos do the rest.',
        run: 'Run', step: 'Step', reset: 'Reset', tracesAria: 'Each joint’s angle over the run, inside its range',
        tracesLabel: 'Joint traces · band = the joint’s range',
        labNote: 'The simulation runs in this browser tab. The page sends nothing.',
        interval: 'Same scene, same commands, same run.',
        intervalCaption: 'Generated footage (fal), not a VibeSim result.',
        fieldsTitle: 'What the description says',
        fields: [
            ['machine', 'Which arm, and where every joint starts. The bench models the SO-101’s published joint ranges and servo limits.'],
            ['goal_mm', 'The point the tool must reach, in millimetres. Inverse kinematics finds angles that get there, inside their ranges.'],
            ['payload_g', 'What the gripper holds, in grams. Gravity and the load show up as torque on every servo in the chain.'],
        ],
        fieldsMore: 'The whole format', engine: 'The engine is copied from CommandAGI’s own simulation core: the same robot model, the same servo step, the same inverse kinematics. A scene and its commands fully determine a run.',
        flockCaption: 'Generated footage (fal).',
        contactTitle: 'Tell us what to simulate.', contactBy: 'VibeSim is a company of CommandAGI.',
        foot: 'simulation by description', language: 'Language', languages: 'Languages', close: 'Close',
    },
    es: {
        file: 'es/index.html', base: '../', self: '/es/',
        title: 'VibeSim — simulación por descripción',
        description: 'VibeSim ejecuta una simulación a partir de una breve descripción escrita. Escribe una frase y un enjambre se convierte en ella; escribe una escena y un brazo con servos la ejecuta, en tu navegador.',
        skip: 'Ir al laboratorio', nav: 'Principal', phases: 'Fases de una ejecución',
        verbs: ['describir', 'instanciar', 'simular', 'inspeccionar'], docs: 'Documentación', lab: 'Banco',
        h1: ['Descríbelo.', 'Se ejecuta.'],
        lede: 'VibeSim convierte unas pocas palabras escritas en un sistema en marcha. Reescribe la frase de abajo y el enjambre detrás de este texto se reconstruye a partir de ella.',
        sentenceLabel: 'Describe el enjambre', sentence: '1600 boids, con miedo al cursor, lentos, cálidos',
        instantiate: 'Instanciar', understoodLabel: 'Entendido', agents: 'agentes', phi: 'orden φ',
        swarmNote: 'Un analizador de palabras lee un número y una lista corta de palabras. No es un modelo de lenguaje.',
        swarmStep: 'Paso', swarmAria: 'Un enjambre de boids, simulado en esta pestaña a partir de la frase',
        tags: { slow: 'lento', fast: 'rápido', 'fears the cursor': 'teme al cursor', 'follows the cursor': 'sigue al cursor', warm: 'cálido', cold: 'frío', tight: 'compacto', loose: 'disperso', wind: 'viento', swirl: 'remolino', '(nothing)': 'ninguna palabra conocida: los valores por defecto' },
        verbsTitle: 'Cuatro verbos, una ejecución',
        verbsText: [
            'Un objeto JSON: la máquina, dónde empieza cada articulación, el punto a alcanzar, la carga.',
            'El SO-101 se construye con sus rangos de articulación publicados. Cada arco es el rango completo de una articulación.',
            'La cinemática inversa encuentra los ángulos; cada servo avanza a un kilohercio hasta que el brazo se detiene.',
            'El ángulo de cada articulación en el tiempo, dentro de su banda. Una traza en el borde es una articulación en su límite.',
        ],
        verbsArm: 'La ejecución de coger y dejar, dibujada en la posición del desplazamiento', verbsTraces: 'Los ángulos de las seis articulaciones durante la ejecución',
        labTitle: 'El banco', labLede: 'Escribe la escena. Ejecútala. Lee lo que hicieron los servos.',
        stageAria: 'El brazo simulado, dibujado a partir de la descripción', hud: 'Pose de reposo.',
        presetsAria: 'Descripciones de ejemplo', presets: ['Alcanzar', 'Coger y dejar', 'Fuera de alcance'],
        sceneLabel: 'La descripción', sceneHelp: 'Apunta la punta de la herramienta (milímetros), indica qué sujeta la pinza y los servos hacen el resto.',
        run: 'Ejecutar', step: 'Paso', reset: 'Reiniciar', tracesAria: 'El ángulo de cada articulación durante la ejecución, dentro de su rango',
        tracesLabel: 'Trazas de articulación · banda = el rango de la articulación',
        labNote: 'La simulación se ejecuta en esta pestaña. La página no envía nada.',
        interval: 'Misma escena, mismos comandos, misma ejecución.',
        intervalCaption: 'Vídeo generado (fal), no un resultado de VibeSim.',
        fieldsTitle: 'Qué dice la descripción',
        fields: [
            ['machine', 'Qué brazo es y dónde empieza cada articulación. El banco modela los rangos de articulación y los límites de servo publicados del SO-101.'],
            ['goal_mm', 'El punto que debe alcanzar la herramienta, en milímetros. La cinemática inversa encuentra los ángulos que llegan allí, dentro de sus rangos.'],
            ['payload_g', 'Qué sujeta la pinza, en gramos. La gravedad y la carga aparecen como par en cada servo de la cadena.'],
        ],
        fieldsMore: 'El formato completo', engine: 'El motor está copiado del núcleo de simulación de CommandAGI: el mismo modelo de robot, el mismo paso de servo, la misma cinemática inversa. Una escena y sus comandos determinan por completo una ejecución.',
        flockCaption: 'Vídeo generado (fal).',
        contactTitle: 'Cuéntanos qué simular.', contactBy: 'VibeSim es una empresa de CommandAGI.',
        foot: 'simulación por descripción', language: 'Idioma', languages: 'Idiomas', close: 'Cerrar',
    },
    'zh-Hans': {
        file: 'zh-Hans/index.html', base: '../', self: '/zh-Hans/',
        title: 'VibeSim — 用描述来仿真',
        description: 'VibeSim 根据一段简短的文字描述运行仿真。输入一句话，鸟群就变成它；写下一个场景，舵机驱动的机械臂就在你的浏览器里运行它。',
        skip: '跳到实验台', nav: '主导航', phases: '一次运行的阶段',
        verbs: ['描述', '实例化', '仿真', '检查'], docs: '文档', lab: '实验台',
        h1: ['描述它，', '它就运行。'],
        lede: 'VibeSim 把几句文字变成一个正在运行的系统。改写下面这句话，这段文字后面的鸟群就按它重建。',
        sentenceLabel: '描述鸟群', sentence: '1600 只，怕光标，慢，暖',
        instantiate: '实例化', understoodLabel: '读懂了', agents: '个体', phi: '有序度 φ',
        swarmNote: '一个词语解析器读取一个数字和一小组词语。它不是语言模型。',
        swarmStep: '单步', swarmAria: '按这句话在当前标签页中仿真的鸟群',
        tags: { slow: '慢', fast: '快', 'fears the cursor': '怕光标', 'follows the cursor': '跟随光标', warm: '暖', cold: '冷', tight: '紧密', loose: '松散', wind: '风', swirl: '漩涡', '(nothing)': '没有认识的词：使用默认值' },
        verbsTitle: '四个动词，一次运行',
        verbsText: [
            '一个 JSON 对象：机器、每个关节的起点、要到达的点、负载。',
            'SO-101 按其公布的关节范围搭建。每段弧是一个关节的完整范围。',
            '逆运动学求出角度；每个舵机以每秒一千步推进，直到机械臂停下。',
            '每个关节的角度随时间的变化，画在它的范围带内。贴着带边的曲线表示关节到了极限。',
        ],
        verbsArm: '抓取并放置的运行，按滚动位置绘制', verbsTraces: '六个关节在运行中的角度',
        labTitle: '实验台', labLede: '写下场景，运行它，读出舵机做了什么。',
        stageAria: '按描述绘制的仿真机械臂', hud: '初始姿态。',
        presetsAria: '示例描述', presets: ['伸到目标', '抓取并放置', '超出可达范围'],
        sceneLabel: '描述', sceneHelp: '用毫米指定工具点要到达的位置，说明夹爪夹着什么，其余交给舵机。',
        run: '运行', step: '单步', reset: '复位', tracesAria: '每个关节在运行中的角度，画在其范围内',
        tracesLabel: '关节曲线 · 带 = 关节范围',
        labNote: '仿真在当前浏览器标签页中运行，页面不发送任何数据。',
        interval: '同样的场景，同样的指令，同样的运行。',
        intervalCaption: '生成的视频（fal），不是 VibeSim 的结果。',
        fieldsTitle: '描述里写了什么',
        fields: [
            ['machine', '用哪条机械臂，每个关节从哪里开始。实验台采用 SO-101 公布的关节范围和舵机限值。'],
            ['goal_mm', '工具要到达的点，单位毫米。逆运动学在关节范围内求出到达该点的角度。'],
            ['payload_g', '夹爪夹着什么，单位克。重力和负载会体现为链条上每个舵机的扭矩。'],
        ],
        fieldsMore: '完整格式', engine: '引擎复制自 CommandAGI 自己的仿真内核：相同的机器人模型、相同的舵机步进、相同的逆运动学。一段场景和它的指令完全决定了一次运行。',
        flockCaption: '生成的视频（fal）。',
        contactTitle: '告诉我们你想仿真什么。', contactBy: 'VibeSim 是 CommandAGI 旗下公司。',
        foot: '用描述来仿真', language: '语言', languages: '语言', close: '关闭',
    },
};

const NAMES = { en: 'English', es: 'Español', 'zh-Hans': '简体中文' };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(lang, t) {
    const b = t.base;
    const others = Object.keys(LOCALES).filter(l => l !== lang);
    const langLink = l => `<a href="${LOCALES[l].self}" hreflang="${l}"${l === lang ? ' aria-current="true" autofocus' : ''}><span lang="${l}">${NAMES[l]}</span></a>`;
    return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}" />
<meta name="theme-color" content="#0b0e12" />
<meta name="color-scheme" content="dark" />
<link rel="canonical" href="https://vibesim.commandagi.app${t.self}" />
${Object.keys(LOCALES).map(l => `<link rel="alternate" hreflang="${l}" href="https://vibesim.commandagi.app${LOCALES[l].self}" />`).join('\n')}
<meta property="og:title" content="${esc(t.title)}" />
<meta property="og:description" content="${esc(t.description)}" />
<meta property="og:image" content="https://vibesim.commandagi.app/og.png" />
<meta property="og:url" content="https://vibesim.commandagi.app${t.self}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="icon" href="${b}mark.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="${b}touch-icon.png" />
<link rel="preload" href="${b}fonts/unbounded.woff2" as="font" type="font/woff2" crossorigin />
<link rel="stylesheet" href="${b}style.css" />
</head>
<body class="home">
<a class="skip" href="#lab">${esc(t.skip)}</a>
<header class="bar">
  <a class="brand" href="./" aria-label="VibeSim"><img class="brand__word" src="${b}wordmark.svg" alt="VibeSim" width="151" height="26" /></a>
  <ol class="rail" aria-label="${esc(t.phases)}">
${t.verbs.map((v, i) => `    <li><a href="#verbs" data-rail="${i}"><span class="rail__n">0${i + 1}</span> ${esc(v)}</a></li>`).join('\n')}
  </ol>
  <nav class="bar__nav" aria-label="${esc(t.nav)}">
    <a href="#lab">${esc(t.lab)}</a>
    <a href="docs/">${esc(t.docs)}</a>
  </nav>
</header>

<main>
  <section class="hero" aria-labelledby="hero-title">
    <canvas id="swarm" class="hero__field" role="img" aria-label="${esc(t.swarmAria)}"></canvas>
    <div class="hero__grid">
      <h1 id="hero-title" class="hero__title"><span>${esc(t.h1[0])}</span> <span class="hero__title-run">${esc(t.h1[1])}</span></h1>
      <p class="hero__lede">${esc(t.lede)}</p>
      <dl class="readout" aria-hidden="true">
        <div><dt>${esc(t.agents)}</dt><dd id="count">—</dd></div>
        <div><dt>${esc(t.phi)}</dt><dd id="phi">—</dd></div>
      </dl>
      <form class="prompt" id="describe">
        <label class="prompt__label" for="sentence">${esc(t.sentenceLabel)}</label>
        <div class="prompt__row">
          <span class="prompt__caret" aria-hidden="true">›</span>
          <input class="prompt__input" id="sentence" name="sentence" value="${esc(t.sentence)}" autocomplete="off" spellcheck="false" enterkeyhint="go" aria-describedby="swarm-note understood-line" />
          <button class="disc" type="submit"><span class="disc__glyph" aria-hidden="true">↵</span><span class="disc__label">${esc(t.instantiate)}</span></button>
        </div>
        <p class="prompt__understood" id="understood-line"><span class="prompt__k">${esc(t.understoodLabel)}</span> <output id="understood" aria-live="polite"></output></p>
        <p class="prompt__note" id="swarm-note">${esc(t.swarmNote)} <button type="button" class="hair still-only" id="swarm-step">${esc(t.swarmStep)}</button></p>
      </form>
    </div>
    <script type="application/json" id="swarm-strings">${JSON.stringify(t.tags)}</script>
  </section>

  <section class="verbs" id="verbs" aria-labelledby="verbs-title">
    <div class="verbs__stage">
      <h2 id="verbs-title" class="verbs__title">${esc(t.verbsTitle)}</h2>
      <ol class="verbs__list">
${t.verbs.map((v, i) => `        <li data-verb="${i}"><span class="verbs__n">0${i + 1}</span><strong>${esc(v)}</strong><span class="verbs__text">${esc(t.verbsText[i])}</span></li>`).join('\n')}
      </ol>
      <pre class="verbs__code" id="verbs-code" aria-hidden="true"></pre>
      <canvas class="verbs__arm" id="verbs-arm" role="img" aria-label="${esc(t.verbsArm)}"></canvas>
      <canvas class="verbs__traces" id="verbs-traces" role="img" aria-label="${esc(t.verbsTraces)}"></canvas>
    </div>
  </section>

  <section class="bench" id="lab" aria-labelledby="lab-title">
    <header class="bench__head">
      <h2 id="lab-title">${esc(t.labTitle)}</h2>
      <p>${esc(t.labLede)}</p>
    </header>
    <div class="lab">
      <div class="lab__stage">
        <canvas id="stage" width="880" height="560" aria-label="${esc(t.stageAria)}" role="img"></canvas>
        <p class="lab__hud" id="hud" aria-live="polite">${esc(t.hud)}</p>
        <p class="lab__label" id="traces-label">${esc(t.tracesLabel)}</p>
        <canvas id="traces" class="lab__traces" width="880" height="240" aria-label="${esc(t.tracesAria)}" role="img"></canvas>
      </div>
      <div class="lab__side">
        <div class="lab__presets" role="group" aria-label="${esc(t.presetsAria)}">
${['reach', 'pick', 'unreachable'].map((p, i) => `          <button type="button" class="chip" data-preset="${p}">${esc(t.presets[i])}</button>`).join('\n')}
        </div>
        <label class="lab__label" for="scene">${esc(t.sceneLabel)}</label>
        <textarea id="scene" class="lab__scene" spellcheck="false" rows="12" aria-describedby="scene-help"></textarea>
        <p class="lab__help" id="scene-help">${esc(t.sceneHelp)}</p>
        <div class="lab__actions">
          <button type="button" class="disc" id="run"><span class="disc__glyph" aria-hidden="true">▶</span><span class="disc__label">${esc(t.run)}</span></button>
          <button type="button" class="hair" id="step">${esc(t.step)}</button>
          <button type="button" class="hair" id="reset">${esc(t.reset)}</button>
          <span class="lab__status" id="status" role="status"></span>
        </div>
        <p class="lab__note">${esc(t.labNote)}</p>
      </div>
    </div>
  </section>

  <section class="interval" aria-label="${esc(t.interval)}">
    <video class="interval__video" data-lazy muted loop playsinline preload="none" poster="${b}media/pigment.jpg" aria-hidden="true">
      <source data-src="${b}media/pigment.webm" type="video/webm; codecs=av01.0.05M.08" />
      <source data-src="${b}media/pigment.mp4" type="video/mp4" />
    </video>
    <p class="interval__line">${esc(t.interval)}</p>
    <p class="caption">${esc(t.intervalCaption)}</p>
  </section>

  <section class="fields" aria-labelledby="fields-title">
    <video class="fields__video" data-lazy muted loop playsinline preload="none" poster="${b}media/flock.jpg" aria-hidden="true">
      <source data-src="${b}media/flock.webm" type="video/webm; codecs=av01.0.05M.08" />
      <source data-src="${b}media/flock.mp4" type="video/mp4" />
    </video>
    <h2 id="fields-title" class="fields__title">${esc(t.fieldsTitle)}</h2>
    <dl class="fields__list">
${t.fields.map(([k, v]) => `      <div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('\n')}
    </dl>
    <p class="fields__engine">${esc(t.engine)} <a class="arrow" href="docs/">${esc(t.fieldsMore)}</a></p>
    <p class="caption">${esc(t.flockCaption)}</p>
  </section>

  <section class="contact" id="contact" aria-labelledby="contact-title">
    <h2 id="contact-title">${esc(t.contactTitle)}</h2>
    <p><a class="contact__mail" href="mailto:hello@vibesim.pro">hello@vibesim.pro</a></p>
    <p class="contact__by">${esc(t.contactBy)}</p>
  </section>
</main>

<footer class="foot">
  <div class="foot__row">
    <p>VibeSim · ${esc(t.foot)} · <a href="mailto:hello@vibesim.pro">hello@vibesim.pro</a></p>
    <div class="lang">
      <button type="button" class="lang-btn" commandfor="lang-dialog" command="show-modal" aria-haspopup="dialog" aria-label="${esc(t.language)}" title="${esc(t.language)}"><span class="lang-btn__glyph" aria-hidden="true">A<span>/</span><span lang="zh-Hans">文</span></span></button>
      <noscript><nav class="lang-links" aria-label="${esc(t.languages)}">${others.map(langLink).join(' ')}</nav></noscript>
      <dialog id="lang-dialog" class="lang-dialog" aria-labelledby="lang-dialog-title">
        <div class="lang-dialog__box">
          <div class="lang-dialog__head"><h2 id="lang-dialog-title">${esc(t.language)}</h2><form method="dialog"><button class="lang-dialog__close" aria-label="${esc(t.close)}">✕</button></form></div>
          <ul class="lang-list">
${Object.keys(LOCALES).map(l => `            <li>${langLink(l)}</li>`).join('\n')}
          </ul>
        </div>
      </dialog>
    </div>
  </div>
</footer>

<script type="module" src="${b}lab/swarm.js"></script>
<script type="module" src="${b}lab/verbs.js"></script>
<script type="module" src="${b}lab/lab.js"></script>
<script type="module" src="${b}lab/page.js"></script>
</body>
</html>
`;
}

for (const [lang, t] of Object.entries(LOCALES)) writeFileSync(resolve(root, t.file), page(lang, t));
console.log('pages: index.html, es/index.html, zh-Hans/index.html');
