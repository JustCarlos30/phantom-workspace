import React from 'react';
import { Composition } from 'remotion';
import { Storyboard } from './Storyboard';
import storyboard from './shots.json';

export const Root: React.FC = () => <Composition id="Storyboard" component={Storyboard} fps={storyboard.fps} width={storyboard.width} height={storyboard.height}
  durationInFrames={Math.max(1, storyboard.shots.reduce((total: number, shot: { frames: number }) => total + shot.frames, 0))} />;
