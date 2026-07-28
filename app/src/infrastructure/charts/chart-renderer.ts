import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

export interface ChartImage {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
}

export function renderChartToImage(
  option: EChartsOption,
  width = 720,
  height = 420,
): Promise<ChartImage> {
  return new Promise((resolve, reject) => {
    const container = document.createElement('div');
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    document.body.appendChild(container);

    const instance = echarts.init(container, undefined, {
      width, height, renderer: 'canvas',
    });

    instance.setOption({
      ...option,
      animation: false,
      backgroundColor: '#fff',
    });

    setTimeout(() => {
      try {
        const dataUrl = instance.getDataURL({
          type: 'png', pixelRatio: 2, backgroundColor: '#fff',
        });
        instance.dispose();
        document.body.removeChild(container);
        resolve({ dataUrl, width: width * 2, height: height * 2 });
      } catch (err) {
        instance.dispose();
        document.body.removeChild(container);
        reject(err);
      }
    }, 100);
  });
}
