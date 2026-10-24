import { useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Camera, type CameraFrameOutput } from 'react-native-vision-camera';

/**
 * A 3:4 camera preview with `contain` scaling, so normalized frame coordinates map exactly onto
 * the overlay drawn on top (the frame output is VGA 4:3, upright).
 */
export function CameraStage({
  position,
  isActive,
  outputs,
  onStopped,
  children,
}: {
  position: 'back' | 'front';
  isActive: boolean;
  outputs: CameraFrameOutput[];
  onStopped?: () => void;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  return (
    <View style={{ width: '100%', aspectRatio: 3 / 4, backgroundColor: '#000', overflow: 'hidden' }} onLayout={onLayout}>
      <Camera
        style={{ flex: 1 }}
        device={position}
        isActive={isActive}
        outputs={outputs}
        resizeMode="contain"
        constraints={[{ fps: 15 }]}
        onStopped={onStopped}
        onError={(e) => console.warn('Camera error', e)}
      />
      {size.width > 0 && children(size)}
    </View>
  );
}
