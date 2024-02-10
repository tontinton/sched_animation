const W = 100;
const HIGHLIGHT = 0x60;

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

  let self = {
    graphics,
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
  }

  return self;
}

function createApp(element) {
  const app = new PIXI.Application({ backgroundAlpha: 0, resizeTo: element, antialias: true });

  const container = new PIXI.Container();
  app.stage.addChild(container);

  const leftQueue = QueueRect(0, 0, 5, 0x6272A4);
  const centerQueue = QueueRect(2, 2, 1, 0xBD93F9);
  const rightQueue = QueueRect(4, 0, 5, 0x8BE9FD);
  const queues = [leftQueue, centerQueue, rightQueue];

  for (const q of queues) {
    q.draw();
    container.addChild(q.graphics);
  }

  function layout(width, height) {
    container.x = width / 2;
    container.y = height / 2;
  }

  layout(app.screen.width, app.screen.height);

  container.pivot.x = container.width / 2;
  container.pivot.y = container.height / 2;

  let tick = 0;
  app.ticker.add(delta => {
    for (const q of queues) {
      if (tick % 100 == 0) {
        q.startHighlight();
      }
      q.update(delta);
    }
    tick += 1;
    // container.rotation -= 0.01 * delta;
  });

  app.renderer.on('resize', layout);

  element.appendChild(app.view);
}
