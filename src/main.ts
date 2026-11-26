import './ui/style.css';
import './ui/readability.css';
import { welcome } from './ui/welcome';

void import('./app/game').then(async ({ Game }) => {
    // Let the opening screen paint before synchronous scene construction starts.
    await new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    const game = new Game();
    if (import.meta.env.DEV) {
        Object.defineProperty(window, '__YUNJING__', { value: game, configurable: true });
        const view = new URL(location.href).searchParams.get('meadowLab');
        if (view === 'near' || view === 'mid' || view === 'wide')
            void import('./dev/meadow-lab').then(m => m.openMeadowLab(game, view));
    }
    import.meta.hot?.dispose(() => game.dispose());
}).catch(error => {
    console.error('云境场景初始化失败', error);
    welcome.fail('场景初始化失败，请刷新页面');
});
