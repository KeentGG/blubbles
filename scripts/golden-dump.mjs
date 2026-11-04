// Builds the golden dump from an engine API surface.
// `scripts/snapshot.mjs` (reference capture) and `scripts/verify-golden.mjs` (comparison)
// both run it against the TypeScript build in dist/. Both must produce the same JSON string.

const TIMES = [0, 0.37, 1.64968, 3.1, 7.77];
const MATRIX_EXPRESSIONS = ['happy', 'curious', 'sleepy'];

const meta = (states) =>
  states.map((s) => ({
    id: s.id,
    duration: s.duration,
    minDuration: s.minDuration ?? null,
    morph: s.morph,
    blinkIn: s.blinkIn ?? false,
    baseFace: s.baseFace,
    baseBody: s.baseBody,
  }));

const entries = (map) => [...map.entries()];

export function buildDump(engine, svg, catalog, createBlubModel) {
  const {
    BlubEngine,
    STATES,
    STATE_BY_ID,
    POSES,
    SHAPES,
    SHAPE_BY_ID,
    COLORS,
    COLOR_BY_ID,
    EXPRESSIONS,
    EXPRESSION_BY_ID,
    blendExpression,
    mixHex,
    TAU,
    RAYON,
    clamp,
    lerp,
    loopNoise,
    easings,
    arcRender,
    RINGS,
    SWOOSH,
    particles,
  } = engine;

  const dump = {};

  dump.meta = {
    times: TIMES,
    matrixExpressions: MATRIX_EXPRESSIONS,
    scale: 100,
    container: 100,
  };

  // ---- exported constant tables -------------------------------------------------
  dump.constants = {
    TAU,
    RAYON,
    states: meta(STATES),
    stateIds: STATES.map((s) => s.id),
    stateByIdKeys: [...STATE_BY_ID.keys()],
    poses: POSES,
    shapes: SHAPES.map((s) => ({ id: s.id, radii: [...s.radii] })),
    shapeByIdKeys: [...SHAPE_BY_ID.keys()],
    colors: COLORS.map((c) => ({ id: c.id, hex: c.hex })),
    colorByIdEntries: entries(COLOR_BY_ID).map(([id, c]) => [id, { id: c.id, hex: c.hex }]),
    expressions: EXPRESSIONS,
    expressionByIdKeys: [...EXPRESSION_BY_ID.keys()],
    rings: RINGS,
    swoosh: SWOOSH,
  };

  dump.math = {
    clamp: [
      [0.5],
      [-1, 0, 1],
      [2, 0, 1],
      [0.3, 0, 2],
      [-3, -2, 4],
      [0.25, 0.5, 0.75],
    ].map((args) => ({ args, value: clamp(...args) })),
    lerp: [
      [0, 1, 0],
      [0, 1, 0.25],
      [-2, 3, 0.5],
      [7.5, -1.25, 0.37],
      [100, -100, 1],
    ].map(([a, b, k]) => ({ a, b, k, value: lerp(a, b, k) })),
    loopNoise: [
      [0, 11.3, 0.4],
      [1.64968, 11.3, 0.4],
      [3.1, 3.7, 2.1],
      [7.77, 9.1, 1.3],
      [12.5, 4.3, 0.7],
      [0.37, 13.7, 3.2],
      [2.2, 7.9, 1.9],
      [9.9, 5.3, 0.3],
    ].map(([t, period, phase]) => ({ t, period, phase, value: loopNoise(t, period, phase) })),
    easings: Object.fromEntries(
      Object.entries(easings).map(([name, fn]) => [
        name,
        [0, 0.13, 0.25, 0.37, 0.5, 0.75, 0.9, 1, 1.3, -0.2].map((x) => ({ x, value: fn(x) })),
      ]),
    ),
    mixHex: [
      ['#3b93f0', '#ffffff', 0.62],
      ['#3b93f0', '#ffffff', 0.2],
      ['#3b93f0', '#0a0a0c', 0.4],
      ['#0a0a0c', '#ffffff', 0],
      ['#e8483f', '#3ecf8e', 0.5],
      ['#f1efe9', '#8b5e3c', 1],
      ['#e152b0', '#f0b429', 0.37],
    ].map(([a, b, k]) => ({ a, b, k, value: mixHex(a, b, k) })),
    blendExpression: [
      ['neutral', 'happy', 0],
      ['neutral', 'happy', 0.25],
      ['neutral', 'happy', 0.5],
      ['neutral', 'happy', 1],
      ['surprised', 'scared', 0.37],
      ['suspicious', 'curious', 0.75],
    ].map(([a, b, k]) => ({
      a,
      b,
      k,
      value: blendExpression(EXPRESSION_BY_ID.get(a), EXPRESSION_BY_ID.get(b), k),
    })),
  };

  // ---- state pose functions ------------------------------------------------------
  dump.poses = STATES.map((state) => ({
    id: state.id,
    poses: [
      0,
      0.3,
      0.7,
      1.3,
      state.duration * 0.5,
      state.duration,
      state.duration + 0.4,
    ].map((t) => ({ t, pose: state.pose(t) })),
  }));

  // ---- BlubEngine.sample matrix ---------------------------------------------------
  // Every STATE x SHAPE x a few EXPRESSIONS, at each time. Fresh engine, default look.
  dump.samples = [];
  for (const state of STATES) {
    for (const shape of SHAPES) {
      for (const exprId of MATRIX_EXPRESSIONS) {
        const expression = EXPRESSION_BY_ID.get(exprId);
        const bot = new BlubEngine(100, state.id, shape.radii, expression);
        for (const t of TIMES) {
          dump.samples.push({
            key: `${state.id}|${shape.id}|${exprId}|${t}`,
            state: state.id,
            shape: shape.id,
            expression: exprId,
            t,
            sample: bot.sample(t),
          });
        }
      }
    }
  }

  // ---- default constructor -------------------------------------------------------
  {
    const bot = new BlubEngine();
    dump.defaultEngine = {
      state: bot.state,
      samples: TIMES.map((t) => ({ t, sample: bot.sample(t) })),
    };
  }

  // ---- morphs, state changes, looks, resets --------------------------------------
  const timeline = (key, setup, times) => {
    const bot = new BlubEngine(100, 'idle', SHAPE_BY_ID.get('circle').radii, EXPRESSION_BY_ID.get('neutral'));
    setup(bot);
    return {
      key,
      state: bot.state,
      times: times.map((entry) => {
        const [t, action] = Array.isArray(entry) ? entry : [entry, null];
        if (action) action(bot, t);
        return { t, sample: bot.sample(t) };
      }),
    };
  };

  dump.timelines = [
    timeline(
      'state-change-idle-burst',
      () => {},
      [
        [0, (b) => b.setState('burst', 0)],
        0.1, 0.2, 0.3, 0.45, 0.6, 0.9, 1.4, 2.0, 2.6, 3.3,
      ],
    ),
    timeline(
      'state-chain-before-morph',
      () => {},
      [
        [0, (b) => b.setState('burst', 0)],
        0.1,
        [0.15, (b) => b.setState('comet', 0.15)],
        0.2, 0.35, 0.6, 1.0, 2.0, 2.4,
      ],
    ),
    timeline(
      'reset-mid-state',
      (b) => {
        b.setState('burst', 0);
      },
      [
        0.5,
        [0.8, (b) => b.reset('idle', 0.8)],
        0.9, 1.0, 1.5,
      ],
    ),
    timeline(
      'shape-morph',
      () => {},
      [
        [0, (b) => b.setShape(SHAPE_BY_ID.get('pebble').radii, 0)],
        0.1, 0.25, 0.44, 0.45, 0.6, 1.0,
        [1.2, (b) => b.setShape(SHAPE_BY_ID.get('cloud').radii, 1.2)],
        1.3, 1.5, 1.64968, 2.0,
      ],
    ),
    timeline(
      'expression-morph',
      () => {},
      [
        [0, (b) => b.setExpression(EXPRESSION_BY_ID.get('happy'), 0)],
        0.1, 0.25, 0.45, 0.7,
        [1.0, (b) => b.setExpression(EXPRESSION_BY_ID.get('sad'), 1.0)],
        1.1, 1.3, 1.5, 2.0,
        [2.2, (b) => b.setExpression(null, 2.2)],
        2.3, 2.6,
      ],
    ),
    timeline(
      'shape-and-expression-morph',
      () => {},
      [
        [0, (b) => b.setShape(SHAPE_BY_ID.get('capsule').radii, 0)],
        [0, (b) => b.setExpression(EXPRESSION_BY_ID.get('surprised'), 0)],
        0.15, 0.3, 0.46,
        [0.7, (b) => b.setShape(SHAPE_BY_ID.get('triangle').radii, 0.7)],
        [0.8, (b) => b.setExpression(EXPRESSION_BY_ID.get('angry'), 0.8)],
        0.9, 1.2, 1.7, 2.2,
        [2.5, (b) => b.setShape(null, 2.5)],
        2.6, 2.9,
      ],
    ),
    timeline(
      'look-ramp',
      () => {},
      [
        [0, (b) => b.setLook({ yaw: 16, pitch: -13, mix: 1, spin: 0, wander: 0 }, 0, 0.85)],
        0.1, 0.3, 0.5, 0.84, 0.86, 1.2, 2.5,
        [3.0, (b) => b.setLook({ yaw: -22, pitch: 9, mix: 0.6, spin: 4.5, wander: 0.25 }, 3.0, 0.5)],
        3.1, 3.3, 3.5, 4.0,
      ],
    ),
    timeline(
      'look-spin-wander',
      () => {},
      [
        [0, (b) => b.setLook({ yaw: 12.5, pitch: -7.25, mix: 1, spin: 9.5, wander: 1 }, 0)],
        0.12, 0.24, 0.5, 1.0, 1.64968, 3.1,
        [4.0, (b) => b.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 4.0)],
        4.2, 4.5, 7.77,
      ],
    ),
    timeline(
      'look-null-and-nonfinite',
      () => {},
      [
        [0, (b) => b.setLook({ yaw: 20, pitch: 10, mix: 1, spin: 2, wander: 0 }, 0)],
        0.3,
        [0.5, (b) => b.setLook(null, 0.5)],
        0.6, 0.8, 1.0,
        [1.2, (b) => b.setLook({ yaw: NaN, pitch: 0, mix: 1, spin: 0, wander: 1 }, 1.2)],
        1.3,
      ],
    ),
    timeline(
      'blink-in',
      () => {},
      [
        [0, (b) => b.setState('wink', 0)],
        0.05, 0.1, 0.15, 0.2, 0.3, 0.6, 1.0,
      ],
    ),
    timeline(
      'notify',
      () => {},
      [
        [0, (b) => b.setState('notify', 0)],
        0.05, 0.2, 0.45, 0.9, 1.5, 2.1,
      ],
    ),
    timeline(
      'all-states',
      () => {},
      STATES.map((s, i) => [i * 2.5, (b) => b.reset(s.id, i * 2.5)]).concat(
        STATES.map((s, i) => i * 2.5 + 0.3),
      ),
    ),
  ];

  // ---- seeded decorations --------------------------------------------------------
  dump.particles = TIMES.concat([0.05, 0.1, 0.2, 0.3, 0.55, 0.62, 1.0]).map((t) => ({
    t,
    scale: 100,
    dots: particles(t, 100),
  }));

  dump.arcs = [
    ...RINGS.map((seed, i) => ({ group: 'ring', i, seed })),
    ...SWOOSH.map((seed, i) => ({ group: 'swoosh', i, seed })),
  ].map(({ group, i, seed }) => ({
    group,
    i,
    at: TIMES.map((t) => ({
      t,
      arc: arcRender(seed, t, 100, `${group}${i}`),
      faint: arcRender(seed, t, 100, `${group}${i}`, 0.37),
    })),
  }));

  // ---- catalog ------------------------------------------------------------------
  dump.catalog = {
    // Slugs are the engine ids now; kept as identity maps so the dump format is stable.
    SHAPE_SLUG: Object.fromEntries(catalog.SHAPES.map((id) => [id, id])),
    SHAPE_LABEL: catalog.SHAPE_LABEL,
    COLOR_SLUG: Object.fromEntries(Object.keys(catalog.COLOR_LABEL).map((id) => [id, id])),
    COLOR_LABEL: catalog.COLOR_LABEL,
    FACE_SLUG: Object.fromEntries(catalog.FACES.map((id) => [id, id])),
    FACE_LABEL: catalog.FACE_LABEL,
    MOVE_LABEL: catalog.MOVE_LABEL,
    SHAPES: catalog.SHAPES,
    FACES: catalog.FACES,
    COLORS: catalog.COLORS,
    ACTIONS: catalog.ACTIONS,
    shapeId: [
      'circle',
      'pebble',
      'cloud',
      'droplet',
      'galet',
      'CERCLE',
      'nope',
      '',
      null,
    ].map((v) => ({ v, id: catalog.shapeId(v) })),
    faceId: ['neutral', 'happy', 'sleepy', 'heureux', 'HILARE', 'nope', null].map((v) => ({
      v,
      id: catalog.faceId(v),
    })),
    colorHex: [
      'blue',
      'red',
      'ink',
      'bleu',
      '#7a4bd6',
      '7A4BD6',
      'ff8800',
      'nope',
      null,
      '  Blue  ',
    ].map((v) => ({ v, hex: catalog.colorHex(v) })),
  };

  // ---- createBlubModel -----------------------------------------------------------
  {
    const timelineFor = (key, opts, steps) => {
      const blub = createBlubModel(opts);
      const out = { key, initial: { state: blub.state, shape: blub.shape, face: blub.face, color: blub.color, finish: blub.finish, paper: blub.paper, eye: blub.eye }, steps: [] };
      for (const [t, action] of steps) {
        if (action) action(blub, t);
        out.steps.push({
          t,
          sample: blub.sample(t),
          state: blub.state,
          shape: blub.shape,
          face: blub.face,
          color: blub.color,
          finish: blub.finish,
          paper: blub.paper,
          eye: blub.eye,
        });
      }
      return out;
    };

    dump.blubs = [
      timelineFor('default', {}, [[0], [0.37], [1.64968], [3.1]]),
      timelineFor(
        'custom',
        { shape: 'cloud', face: 'curious', color: 'purple', finish: 'flat', paper: '#ffffff', eye: 'auto', action: 'thinking' },
        [[0], [0.5], [1.2], [2.4]],
      ),
      timelineFor(
        'mutators',
        { shape: 'pebble', face: 'happy', color: 'blue' },
        [
          [0],
          [0.4, (b) => b.setShape('droplet', 0.4)],
          [0.6, (b) => b.setFace('angry', 0.6)],
          [0.8, (b) => b.setColor('red')],
          [1.0, (b) => b.setFinish('flat')],
          [1.1],
          [1.2, (b) => b.play('burst', 1.2)],
          [1.4],
          [1.6, (b) => b.play('burst', 1.6)],
          [1.8, (b) => b.play('burst', 1.8, { restart: true })],
          [2.0],
          [2.2, (b) => b.look({ yaw: 16, pitch: -13 }, 2.2)],
          [2.4],
          [2.6, (b) => b.look(null, 2.6)],
          [2.8],
        ],
      ),
      timelineFor(
        'hex-and-auto-eye',
        { color: '#f1efe9' },
        [
          [0, (b) => b.setColor('7a4bd6')],
          [0.3],
          [0.6, (b) => b.setColor('#111111')],
          [0.9],
          [1.2, (b) => b.setColor('cream')],
          [1.5],
        ],
      ),
      timelineFor(
        'colour-fallback',
        { shape: 'circle', face: 'neutral', color: 'nope' },
        [[0], [0.5]],
      ),
    ];

    dump.blubErrors = [
      () => createBlubModel({ shape: 'nope' }),
      () => createBlubModel({ face: 'nope' }),
      () => createBlubModel({ action: 'nope' }),
    ].map((run) => {
      try {
        run();
        return { message: null };
      } catch (err) {
        return { name: err.name, message: err.message };
      }
    });
  }

  // ---- renderSVG ----------------------------------------------------------------
  const renderCases = [];
  const renderFor = (key, stateId, shapeId, exprId, t, opts) => {
    const bot = new BlubEngine(
      100,
      stateId,
      SHAPE_BY_ID.get(shapeId).radii,
      EXPRESSION_BY_ID.get(exprId),
    );
    bot.setLook({ yaw: 0, pitch: 0, mix: 1, spin: 0, wander: 1 }, 0);
    renderCases.push({ key, t, opts, svg: svg.renderSVG(bot.sample(t), opts) });
  };

  renderFor('pebble-happy-clay', 'idle', 'pebble', 'happy', 1.64968, {
    color: '#3b93f0',
    size: 512,
    crop: 124,
    scale: 158,
    paper: '#ffffff',
    clay: true,
    uid: 'v',
    background: null,
  });
  renderFor('pebble-happy-flat', 'idle', 'pebble', 'happy', 1.64968, {
    color: '#3b93f0',
    size: 256,
    clay: false,
    paper: '#0a0a0c',
    uid: 'flat',
    background: '#ffffff',
  });
  renderFor('cloud-curious-defaults', 'idle', 'cloud', 'curious', 3.1, {});
  renderFor('capsule-excited-eye', 'idle', 'capsule', 'excited', 7.77, {
    color: '#f08a24',
    size: 128,
    paper: '#ffffff',
    eye: '#111111',
    clay: true,
    uid: 'eye',
    background: '#222222',
  });
  renderFor('triangle-surprised-clay', 'idle', 'triangle', 'surprised', 0.37, {
    color: '#8b5cf6',
    size: 1024,
    crop: 140,
    scale: 170,
    paper: '#0a0a0c',
    clay: true,
    uid: 'tri',
    background: null,
  });
  renderFor('burst-dots-behind', 'burst', 'circle', 'neutral', 0.3, {
    color: '#e8483f',
    size: 512,
    paper: '#ffffff',
    clay: true,
    uid: 'burst',
    background: null,
  });
  renderFor('comet-arcs', 'comet', 'circle', 'neutral', 1.1, {
    color: '#3ecf8e',
    size: 512,
    paper: '#0a0a0c',
    clay: false,
    uid: 'comet',
    background: '#101014',
  });
  renderFor('notify-notch', 'notify', 'circle', 'neutral', 0.8, {
    color: '#2496e8',
    size: 512,
    paper: '#ffffff',
    clay: true,
    uid: 'notify',
    background: '#ffffff',
  });
  renderFor('orbit-rings', 'orbit', 'circle', 'neutral', 1.0, {
    color: '#f0b429',
    size: 320,
    paper: '#0a0a0c',
    clay: true,
    uid: 'orbit',
    background: null,
  });
  renderFor('swirl-minimal', 'swirl', 'circle', 'neutral', 0.5, {
    color: '#a3a3a3',
    clay: false,
    uid: 'swirl',
  });

  dump.renderSVG = renderCases;
  dump.palette = {
    PAPER: svg.PAPER,
    INK: svg.INK,
    CREAM: svg.CREAM,
    NOTIF_BLUE: svg.NOTIF_BLUE,
    autoEye: ['#0a0a0c', '#3b93f0', '#f1efe9', '#ffffff', '#7a4bd6', '#3ecf8e', '#000000', '#aaaaaa'].map(
      (body) => ({ body, eye: svg.autoEye(body) }),
    ),
  };

  return dump;
}

/** Stringify the dump, refusing non-finite numbers (JSON would turn them into null). */
export function stringifyDump(dump) {
  return JSON.stringify(dump, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`non-finite number in golden dump: ${value}`);
    }
    return value;
  }, 2);
}
