function createApp(element) {
  const app = new PIXI.Application({ backgroundAlpha: 0, resizeTo: element });

  const container = new PIXI.Container();

  app.stage.addChild(container);

  // Create a new texture
  const texture = PIXI.Texture.from('https://pixijs.com/assets/bunny.png');

  // Create a 5x5 grid of bunnies
  for (let i = 0; i < 25; i++) {
    const bunny = new PIXI.Sprite(texture);

    bunny.anchor.set(0.5);
    bunny.x = (i % 5) * 40;
    bunny.y = Math.floor(i / 5) * 40;
    container.addChild(bunny);
  }

  function layout(width, height) {
    // Move container to the center
    container.x = width / 2;
    container.y = height / 2;
  }

  layout(app.screen.width, app.screen.height);

  // Center bunny sprite in local container coordinates
  container.pivot.x = container.width / 2;
  container.pivot.y = container.height / 2;

  // Listen for animate update
  app.ticker.add(delta => {
    // rotate the container!
    // use delta to create frame-independent transform
    container.rotation -= 0.01 * delta;
  });

  app.renderer.on('resize', layout);

  element.appendChild(app.view);
}
