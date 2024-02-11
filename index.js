const W = 100;
const HIGHLIGHT = 0x60;
const RADIUS = 0.25;
const HEIGHT = 4;
const PROGRESS_WIDTH = 8;
const TWO_PI = Math.PI * 2;

function Tween(func, time, reverseOnEnd) {
  let step = 1 / time;
  let value = 0; // up to 1 - meaning done.
  let reverse = false;
  return {
    update: delta => {
      const nextValue = value + (reverse ? -step : step) * delta;
      value = Math.max(Math.min(nextValue, 1), 0);

      let end = reverse ? value === 0 : value === 1;
      if (value === 1 && reverseOnEnd) {
        reverse = true;
        end = false;
      }

      return [Math.max(Math.min(func(value), 1), 0), end];
    },
  };
}

function QueueRect(x, y, height, baseColor) {
  const graphics = new PIXI.Graphics();
  let color = baseColor;
  let highlight = null;
  let circles = [];

  let self = {
    init: (container) => {
      self.draw();
      container.addChild(graphics);
    },
    draw: () => {
      graphics.clear();
      graphics.lineStyle(4, color, 1);
      graphics.beginFill(color, 0.05);
      graphics.drawRoundedRect(x * W, y * W, W, W * height, W / 8);
      graphics.endFill();
    },
    update: delta => {
      if (!highlight) {
        return;
      }

      const [value, done] = highlight.update(delta);

      const r = Math.min(((baseColor & 0xFF0000) >> 16) + Math.round(HIGHLIGHT * value), 0xFF) << 16;
      const g = Math.min(((baseColor & 0x00FF00) >> 8) + Math.round(HIGHLIGHT * value), 0xFF) << 8;
      const b = Math.min((baseColor & 0x0000FF) + Math.round(HIGHLIGHT * value), 0xFF);

      color = r + g + b;
      self.draw();

      if (done) {
        highlight = null;
      }
    },
    startHighlight: () => {
      highlight = Tween(x => x ** 2, 10, true);
    },
    push: circle => {
      circle.updatePosition(x, y + height - circles.length - 1);
      circles.push(circle);
      self.startHighlight();
    },
    pop: () => {
      const result = circles.length === 0 ? null : circles.shift();
      if (result) {
        let i = 0;
        for (const circle of circles) {
          circle.updatePosition(x, y + height - i - circles.length - 1);
          i++;
        }
      }
      return result;
    },
    peek: () => {
      return circles.length === 0 ? null : circles[0];
    }
  }

  return self;
}

const TaskState = Object.freeze({
	Idle: Symbol("idle"),
	Blocked: Symbol("blocked"),
	Running: Symbol("running"),
	Moving: Symbol("moving"),
})

function TaskCircle(startState, runTime) {
  const graphics = new PIXI.Graphics();
  let x = 0;
  let y = 0;

  const edge = new PIXI.Graphics();

  const mask = new PIXI.Graphics();
  edge.mask = mask;

  let progress = null;
  let state = startState;

  let self = {
    init: (container) => {
      self.draw();
      container.addChild(graphics);
      container.addChild(edge);
      container.addChild(mask);
    },
    draw: () => {
      graphics.clear();
      graphics.beginFill(0xFF5555, 1);
      graphics.drawCircle((x + RADIUS * 2) * W, (y + RADIUS * 2) * W, RADIUS * W);
      graphics.endFill();

      edge.clear();
      edge.lineStyle(PROGRESS_WIDTH, 0xF8F8F2, 1);
      edge.drawCircle((x + RADIUS * 2) * W, (y + RADIUS * 2) * W, PROGRESS_WIDTH + RADIUS * W);
      edge.endFill();
    },
    update: delta => {
      if (!progress) {
        return;
      }

      const [value, done] = progress.update(delta); 
      const phase = TWO_PI * (state === TaskState.Running ? value : 1 - value);

      const angleStart = 0 - Math.PI / 2;
      const angle = phase + angleStart;

      const x1 = (x + RADIUS * 2);
      const y1 = (y + RADIUS * 2);

      mask.clear();
      mask.lineStyle(1, 0x000000, 1);
      mask.beginFill(0x000000, 1);
      mask.moveTo(x1 * W, y1 * W);
      mask.arc(x1 * W, y1 * W, PROGRESS_WIDTH + RADIUS * W, angleStart, angle, false);
      mask.endFill();

      if (done) {
        self.setState(state === TaskState.Running ? TaskState.Blocked : TaskState.Idle);
      }
    },
    setState: newState => {
      state = newState;

      if (state === TaskState.Running || state === TaskState.Blocked) {
        progress = Tween(x => x, runTime, false);
      } else {
        progress = null;
      }
    },
    updatePosition: (a, b) => {
      x = a;
      y = b;
    },
  };

  self.setState(startState);

  return self;
}

function createApp(element) {
  const app = new PIXI.Application({ backgroundAlpha: 0, resizeTo: element, antialias: true });

  const leftQueue = QueueRect(0, 0, HEIGHT, 0x6272A4);
  const centerQueue = QueueRect(2, (HEIGHT - 1) / 2, 1, 0xBD93F9);
  const rightQueue = QueueRect(4, 0, HEIGHT, 0x8BE9FD);

  let circle = TaskCircle(TaskState.Running, 20);
  centerQueue.push(circle);
  const drawables = [leftQueue, centerQueue, rightQueue, circle];

  const container = new PIXI.Container();
  app.stage.addChild(container);

  for (const drawable of drawables) {
    drawable.init(container);
  }

  function layout(width, height) {
    container.x = width / 2;
    container.y = height / 2;
  }

  layout(app.screen.width, app.screen.height);

  container.pivot.x = container.width / 2;
  container.pivot.y = container.height / 2;

  app.ticker.add(delta => {
    for (const drawable of drawables) {
      drawable.update(delta);
    }
  });

  app.renderer.on('resize', layout);

  element.appendChild(app.view);
}
