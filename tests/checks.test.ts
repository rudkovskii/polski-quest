import { describe, expect, it } from 'vitest';
import { scan } from '../tools/check_banned';
import { checkFile } from '../tools/check_layers';

describe('check:banned', () => {
  it('ловит Phaser 3 API', () => {
    expect(scan('src/scenes/X.ts', 'x.preFX')).toHaveLength(1);
    expect(scan('src/scenes/X.ts', 'new Phaser.Geom.Point(1, 2)')).toHaveLength(1);
    expect(scan('src/scenes/X.ts', 'sprite.setPipeline("Light2D")')).toHaveLength(1);
  });
  it('время и хранилище запрещены только в чистых systems', () => {
    expect(scan('src/systems/srs.ts', 'const t = Date.now();')).toHaveLength(1);
    expect(scan('src/systems/platform/sync.ts', 'await fetch(url)')).toHaveLength(0);
  });
  it('текст в canvas только с пометкой HUD', () => {
    expect(scan('src/scenes/X.ts', "this.add.text(0, 0, 'Cześć')")).toHaveLength(1);
    expect(scan('src/scenes/X.ts', "this.add.text(0, 0, '12') // banned-ok: hud-digits")).toHaveLength(0);
  });
  it('чистый код проходит', () => {
    expect(scan('src/scenes/X.ts', 'const v = new Phaser.Math.Vector2(1, 2);')).toHaveLength(0);
  });
});

describe('check:layers', () => {
  it('systems не импортирует phaser и ui', () => {
    expect(checkFile('src/systems/srs.ts', "import Phaser from 'phaser';")).toHaveLength(1);
    expect(checkFile('src/systems/srs.ts', "import { el } from '../ui/dom';")).toHaveLength(1);
  });
  it('scenes и ui не импортируют друг друга', () => {
    expect(checkFile('src/scenes/Title.ts', "import { el } from '../ui/dom';")).toHaveLength(1);
    expect(checkFile('src/ui/screens/title.ts', "import { Title } from '../../scenes/Title';")).toHaveLength(1);
    expect(checkFile('src/scenes/Title.ts', "import { bus } from '../systems/bus';")).toHaveLength(0);
  });
  it('systems не трогает window/document, но строки и комментарии не считаются', () => {
    expect(checkFile('src/systems/x.ts', 'const w = window.innerWidth;')).toHaveLength(1);
    expect(checkFile('src/systems/x.ts', "// window\nconst s = 'document';")).toHaveLength(0);
    expect(checkFile('src/systems/platform/storage.ts', 'localStorage.getItem("a")')).toHaveLength(0);
  });
});
