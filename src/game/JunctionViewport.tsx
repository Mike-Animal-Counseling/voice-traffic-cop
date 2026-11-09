import { useEffect, useRef, useState } from 'react';
import { IllustratedJunction } from './IllustratedJunction';
import type { CameraView, JunctionRenderer } from './junction3d';
import type { GameState } from './types';

export function JunctionViewport({ game }: { game: GameState }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<JunctionRenderer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [view, setView] = useState<CameraView>('tilted');

  useEffect(() => {
    let mounted = true;
    const useIllustration = () => {
      scene.current?.dispose();
      scene.current = null;
      if (mounted) setStatus('unavailable');
    };

    void import('./junction3d').then(({ createJunction }) => {
      if (!mounted || !host.current) return;
      scene.current = createJunction(host.current, useIllustration);
      setStatus('ready');
    }).catch(useIllustration);

    return () => {
      mounted = false;
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    scene.current?.draw(game, view);
  }, [game, view, status]);

  return (
    <>
      {status !== 'ready' && <IllustratedJunction game={game} />}
      <div className="junction-surface" ref={host} data-active={status === 'ready'} aria-hidden="true" />
      {status === 'ready' && (
        <button
          className="junction-camera"
          type="button"
          aria-label="Overhead view"
          aria-pressed={view === 'overhead'}
          onKeyDown={(event) => {
            if (event.code === 'Space') event.stopPropagation();
          }}
          onClick={() => setView((current) => current === 'tilted' ? 'overhead' : 'tilted')}
        >
          <span aria-hidden="true">⌗</span> Overhead
        </button>
      )}
    </>
  );
}
