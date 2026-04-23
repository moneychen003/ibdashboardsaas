import { useEffect, useRef, useState } from 'react';

function isDarkMode() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function injectDarkTheme(opt) {
  if (!isDarkMode() || !opt) return opt;
  const dark = {
    backgroundColor: 'transparent',
    textStyle: { color: '#aaa' },
    legend: { textStyle: { color: '#aaa' } },
    tooltip: { backgroundColor: 'rgba(20,20,20,0.95)', borderColor: '#444', textStyle: { color: '#eee' } },
  };
  const merge = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    const out = { ...obj };
    if (out.xAxis) {
      [].concat(out.xAxis).forEach((ax) => {
        if (ax) { ax.axisLine = { ...(ax.axisLine || {}), lineStyle: { ...(ax.axisLine?.lineStyle || {}), color: '#444' } }; ax.axisLabel = { ...(ax.axisLabel || {}), color: '#999' }; ax.splitLine = { ...(ax.splitLine || {}), lineStyle: { ...(ax.splitLine?.lineStyle || {}), color: '#222' } }; }
      });
    }
    if (out.yAxis) {
      [].concat(out.yAxis).forEach((ax) => {
        if (ax) { ax.axisLine = { ...(ax.axisLine || {}), lineStyle: { ...(ax.axisLine?.lineStyle || {}), color: '#444' } }; ax.axisLabel = { ...(ax.axisLabel || {}), color: '#999' }; ax.splitLine = { ...(ax.splitLine || {}), lineStyle: { ...(ax.splitLine?.lineStyle || {}), color: '#222' } }; }
      });
    }
    return out;
  };
  return merge({ ...dark, ...opt });
}

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
          instanceRef.current.setOption(injectDarkTheme(option), true);
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
        instanceRef.current.setOption(injectDarkTheme(option), true);
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
