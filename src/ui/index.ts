// Точка монтирования DOM-оверлея.
import { mountLink } from './screens/link';
import { mountStart } from './screens/start';
import { mountTitle } from './screens/title';
import { mountSyncDot } from './syncDot';

export function mountUi(root: HTMLElement): void {
  mountTitle(root);
  mountStart(root);
  mountLink(root);
  mountSyncDot(root);
}
