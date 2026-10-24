import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { loadTensorflowModel, type TensorflowModelDelegate, type TfliteModel } from 'react-native-fast-tflite';

import { MODEL_ASSETS } from './modelAssets';

export type ModelState = { status: 'loading' } | { status: 'missing' } | { status: 'error'; error: string } | { status: 'ready'; model: TfliteModel };

async function load(asset: number, accelerate: boolean): Promise<TfliteModel> {
  const delegates: TensorflowModelDelegate[] = !accelerate ? [] : Platform.OS === 'ios' ? ['core-ml'] : ['android-gpu'];
  try {
    return await loadTensorflowModel(asset, delegates);
  } catch (e) {
    // Older phones often lack a usable GPU delegate; the CPU path always works.
    if (delegates.length) return loadTensorflowModel(asset, []);
    throw e;
  }
}

function useModel(asset: number | null, accelerate: boolean): ModelState {
  const [state, setState] = useState<ModelState>(asset == null ? { status: 'missing' } : { status: 'loading' });
  useEffect(() => {
    if (asset == null) return;
    let alive = true;
    load(asset, accelerate)
      .then((model) => alive && setState({ status: 'ready', model }))
      .catch((e) => alive && setState({ status: 'error', error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [asset, accelerate]);
  return state;
}

export function useLuluModels() {
  const yolo = useModel(MODEL_ASSETS.yolo, true);
  const pose = useModel(MODEL_ASSETS.pose, true);
  const yamnet = useModel(MODEL_ASSETS.yamnet, false);
  return { yolo, pose, yamnet };
}

export function describeModels(m: ReturnType<typeof useLuluModels>): string {
  const s = (name: string, st: ModelState) => `${name}:${st.status}`;
  return [s('yolo', m.yolo), s('pose', m.pose), s('yamnet', m.yamnet)].join(' ');
}
