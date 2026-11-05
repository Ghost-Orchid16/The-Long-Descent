import './styles/base.css';

const params = new URLSearchParams(location.search);
const dev = params.get('dev');

if (dev === 'm1') {
  import('./dev/m1.js').then((m) => m.start(params));
} else {
  import('./game/boot.js').then((m) => m.boot(params));
}
