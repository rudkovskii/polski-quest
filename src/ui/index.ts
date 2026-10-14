// Точка монтирования DOM-оверлея.
import { mountTitle } from './screens/title';

export function mountUi(root: HTMLElement): void {
  mountTitle(root);
}
