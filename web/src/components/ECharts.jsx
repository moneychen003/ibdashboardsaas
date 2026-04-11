import { useEffect, useRef, useState } from 'react';

export default function ECharts({ option, style = {}, className = '' }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const [echartsMod, setEchartsMod] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    import('echarts')
      .then((mod) => {
        if (!mounted) return;
        // echarts v5 exports init directly on the module namespace
        const ec = mod.init ? mod : mod.default;
        setEchartsMod(ec);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!echartsMod || !chartRef.current) return;
    // Delay init slightly to ensure the DOM container has been laid out
    const timer = setTimeout(() => {
      if (!chartRef.current) return;
      try {
        instanceRef.current = echartsMod.init(chartRef.current, undefined, {
          renderer: 'canvas',
        });
        const handleResize = () => instanceRef.current && instanceRef.current.resize();
        window.addEventListener('resize', handleResize);
        if (option) {
          instanceRef.current.setOption(option, true);
        }
      } catch (e) {
        setError(e.message);
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      if (instanceRef.current) {
        try {
          instanceRef.current.dispose();
        } catch (e) {
          // ignore
        }
        instanceRef.current = null;
      }
    };
  }, [echartsMod]);

  useEffect(() => {
    if (instanceRef.current && option) {
      try {
        instanceRef.current.setOption(option, true);
      } catch (e) {
        setError(e.message);
      }
    }
  }, [option]);

  if (error) {
    return (
      <div
        className={className}
        style={{ width: '100%', height: 320, ...style }}
      >
        <div className="flex h-full items-center justify-center text-sm text-[var(--danger)]">
          图表加载失败: {error}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chartRef}
      className={className}
      style={{ width: '100%', height: 320, ...style }}
    />
  );
}
