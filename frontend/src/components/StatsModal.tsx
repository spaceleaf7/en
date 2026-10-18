import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RootData } from '../types';
import type { ProgressApi } from '../hooks/useProgress';
import {
  getCommonMistake,
  getDifficultWords,
  getDueForecast,
  getDueWordIds,
  getForgettingRate,
  getHourlyDistribution,
  getOverallSummary,
  getStreak,
  getTodayProgress,
  getTrend,
  type TrendPoint,
} from '../utils/stats';
import { X, Award, Flame, Clock, BookOpen, AlertTriangle, Download, Upload, Sparkles, Settings2 } from 'lucide-react';
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, GaugeChart, GridComponent, TooltipComponent, CanvasRenderer]);

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** 近 7 天趋势柱状图 */
function TrendChart({ trend, mode }: { trend: TrendPoint[]; mode: 'minutes' | 'words' }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    const chart = chartRef.current;

    const todayKey = trend[trend.length - 1]?.date ?? '';
    const values = trend.map((p) => (mode === 'minutes' ? p.minutes : p.words));
    const labels = trend.map((p) => {
      if (p.date === todayKey) return '今天';
      const [, m, d] = p.date.split('-');
      return `${m}/${d}`;
    });
    const colors = trend.map((p) =>
      p.date === todayKey ? '#2563eb' : 'rgba(37,99,235,0.28)',
    );

    chart.setOption({
      grid: { top: 8, bottom: 28, left: 8, right: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          color: '#94a3b8',
          formatter: (v: string, i: number) =>
            trend[i].date === todayKey ? `{today|${v}}` : v,
          rich: { today: { color: '#2563eb', fontWeight: 700 } },
        },
      },
      yAxis: { type: 'value', show: false },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const p = params[0];
          const unit = mode === 'minutes' ? ' 分钟' : ' 词';
          return `${p.name}：${p.value}${unit}`;
        },
      },
      series: [
        {
          type: 'bar',
          data: values.map((v, i) => ({ value: v, itemStyle: { color: colors[i], borderRadius: [4, 4, 0, 0] } })),
          barMaxWidth: 32,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [trend, mode]);

  useEffect(() => () => { chartRef.current?.dispose(); chartRef.current = null; }, []);

  return <div ref={ref} style={{ height: 180, width: '100%' }} />;
}

/** 遗忘率圆环 */
function ForgetChart({ rate }: { rate: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    const chart = chartRef.current;

    const pctVal = rate === null ? 0 : Math.round(rate * 100);
    const color = pctVal <= 30 ? '#10b981' : pctVal <= 60 ? '#f59e0b' : '#ef4444';
    const desc = rate === null ? '暂无数据' : pctVal <= 30 ? '记忆状态良好' : pctVal <= 60 ? '记忆状态一般' : '记忆较难保留';

    chart.setOption({
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: '86%',
          center: ['50%', '58%'],
          progress: { show: true, width: 10, itemStyle: { color } },
          axisLine: { lineStyle: { width: 10, color: [[1, '#e2e8f0']] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          detail: {
            valueAnimation: true,
            formatter: rate === null ? '—' : `{v|${pctVal}%}\n{d|${desc}}`,
            rich: {
              v: { fontSize: 22, fontWeight: 700, color: '#0f172a', lineHeight: 28 },
              d: { fontSize: 11, color: '#64748b', lineHeight: 18 },
            },
            offsetCenter: [0, '10%'],
          },
          data: [{ value: pctVal }],
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [rate]);

  useEffect(() => () => { chartRef.current?.dispose(); chartRef.current = null; }, []);

  return <div ref={ref} style={{ height: 160, width: '100%' }} />;
}

/** 未来 7 天到期柱状图 */
function ForecastChart({ forecast }: { forecast: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!chartRef.current) chartRef.current = echarts.init(ref.current);
    const chart = chartRef.current;

    const now = new Date();
    const labels = forecast.map((_, i) => {
      if (i === 0) return '今天';
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${m}/${dd}`;
    });

    chart.setOption({
      grid: { top: 24, bottom: 28, left: 8, right: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { fontSize: 10, color: '#94a3b8' },
      },
      yAxis: { type: 'value', show: false },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => `${params[0].name}：${params[0].value} 词`,
      },
      series: [
        {
          type: 'bar',
          data: forecast.map((v, i) => ({
            value: v,
            itemStyle: {
              color: i === 0 ? '#f59e0b' : 'rgba(245,158,11,0.35)',
              borderRadius: [4, 4, 0, 0],
            },
            label: {
              show: v > 0,
              position: 'top',
              fontSize: 10,
              color: i === 0 ? '#f59e0b' : '#94a3b8',
              formatter: '{c}',
            },
          })),
          barMaxWidth: 32,
        },
      ],
    });

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [forecast]);

  useEffect(() => () => { chartRef.current?.dispose(); chartRef.current = null; }, []);

  return <div ref={ref} style={{ height: 160, width: '100%' }} />;
}

/** 学习时段热力方块（纯 CSS） */
function HourlyHeatmap({ hourly }: { hourly: number[] }) {
  const max = Math.max(...hourly, 1);
  const peakHour = hourly.indexOf(Math.max(...hourly));

  const COLORS = ['#e2e8f0', '#bfdbfe', '#93c5fd', '#3b82f6', '#1d4ed8'];
  const getColor = (v: number) => {
    if (v === 0) return COLORS[0];
    const tier = Math.ceil((v / max) * 4);
    return COLORS[Math.min(tier, 4)];
  };

  return (
    <div>
      <div className="hourly-grid">
        {hourly.map((v, h) => (
          <div
            key={h}
            className="hourly-cell"
            style={{ background: getColor(v) }}
            title={`${h}点：${v} 次`}
          />
        ))}
      </div>
      <div className="hourly-axis">
        <span>0 点</span>
        <span>6 点</span>
        <span>12 点</span>
        <span>18 点</span>
        <span>23 点</span>
      </div>
      <p className="chart-sub-text">
        {max > 0 ? `你最常在 ${peakHour} 点学习` : '暂无学习时段数据'}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main modal
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean;
  onClose: () => void;
  progress: ProgressApi;
  roots: RootData[];
  onOpenSettings: () => void;
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export const StatsModal: React.FC<Props> = ({ isOpen, onClose, progress, roots, onOpenSettings }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { state } = progress;
  const [now] = useState(() => Date.now());
  const [trendMode, setTrendMode] = useState<'minutes' | 'words'>('minutes');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const wordIndex = useMemo(() => {
    const map = new Map<number, { word: string; meaning: string; rootText: string }>();
    roots.forEach((r) => r.words.forEach((w) => map.set(w.wordId, { word: w.word, meaning: w.chineseMeaning, rootText: r.rootText })));
    return map;
  }, [roots]);

  if (!isOpen) return null;

  const today = getTodayProgress(state, now);
  const streak = getStreak(state, now);
  const overall = getOverallSummary(state, [...wordIndex.keys()]);
  const dueCount = getDueWordIds(state, now).length;
  const difficult = getDifficultWords(state, 5);
  const trend = getTrend(state, now, 7);
  const forgetRate = getForgettingRate(state);
  const forecast = getDueForecast(state, now, 7);
  const hourly = getHourlyDistribution(state);
  const totalWords = roots.reduce((s, r) => s + r.words.length, 0);
  const forecastTotal = forecast.reduce((s, v) => s + v, 0);
  const weekMinutes = trend.reduce((s, p) => s + p.minutes, 0);

  const handleExport = () => {
    const blob = new Blob([progress.exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etymomind-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!window.confirm('导入会把备份中的学习记录合并到当前账号（不会覆盖已有记录），确定继续吗？')) return;
    try {
      const { imported, skipped } = progress.importBackup(await file.text());
      window.alert(`已导入 ${imported} 条作答记录${skipped ? `，${skipped} 条因单词不在当前词库中被跳过` : ''}`);
    } catch (err) {
      window.alert(`导入失败：${(err as Error).message}`);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card stats-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-title-icon">
              <Award size={20} />
            </div>
            <div>
              <div className="modal-title" id="stats-modal-title">学习数据看板</div>
              <div className="modal-subtitle">
                共 {roots.length} 词根 · {totalWords} 单词
              </div>
            </div>
          </div>
          <div className="modal-header-actions">
            <button className="action-btn-clean" onClick={onOpenSettings} title="修改每日新词与学习时长目标">
              <Settings2 size={14} /> 学习目标
            </button>
            <button className="modal-close-btn" onClick={onClose} aria-label="关闭">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Hero cards */}
        <div className="stats-hero-grid">
          <div className="stat-card-modern">
            <div className="stat-icon-pill amber"><Flame size={18} /></div>
            <div className="stat-meta">
              <div className="stat-value">{streak.current}<span className="stat-unit">天</span></div>
              <div className="stat-title">连续学习</div>
              <div className="stat-sub">最长连续 {streak.longest} 天 · 保持这份节奏</div>
            </div>
          </div>
          <div className="stat-card-modern">
            <div className="stat-icon-pill blue"><BookOpen size={18} /></div>
            <div className="stat-meta">
              <div className="stat-value">{today.newWords}<span className="stat-total"> / {today.newGoal}</span><span className="stat-unit">词</span></div>
              <div className="stat-title">今日新词</div>
              <div className="stat-sub">今日已复习 {today.reviewed} 词</div>
            </div>
          </div>
          <div className="stat-card-modern">
            <div className="stat-icon-pill emerald"><Clock size={18} /></div>
            <div className="stat-meta">
              <div className="stat-value">{today.minutes}<span className="stat-total"> / {today.minutesGoal}</span><span className="stat-unit">分钟</span></div>
              <div className="stat-title">今日学习时长</div>
              <div className="stat-sub">今日正确率 {pct(today.accuracy)}</div>
            </div>
          </div>
        </div>

        {/* Charts row 1: trend + forget rate */}
        <div className="stats-charts-row two-col">
          <div className="chart-panel">
            <div className="chart-panel-header">
              <span className="chart-panel-title">近 7 天学习趋势</span>
              <div className="trend-tab-group">
                <button
                  className={`trend-tab-btn ${trendMode === 'minutes' ? 'active' : ''}`}
                  onClick={() => setTrendMode('minutes')}
                >学习时长</button>
                <button
                  className={`trend-tab-btn ${trendMode === 'words' ? 'active' : ''}`}
                  onClick={() => setTrendMode('words')}
                >单词数</button>
              </div>
            </div>
            <TrendChart trend={trend} mode={trendMode} />
            {trendMode === 'minutes' && (
              <p className="chart-sub-text">
                本周累计 {weekMinutes} 分钟 · 今日 {today.minutes} 分钟
              </p>
            )}
          </div>

          <div className="chart-panel">
            <div className="chart-panel-header">
              <span className="chart-panel-title">遗忘率</span>
            </div>
            <ForgetChart rate={forgetRate} />
            <p className="chart-sub-text">已学单词复习时答错的比例</p>
          </div>
        </div>

        {/* Charts row 2: forecast + hourly */}
        <div className="stats-charts-row two-col">
          <div className="chart-panel">
            <div className="chart-panel-header">
              <span className="chart-panel-title">未来 7 天到期</span>
              <span className="forecast-total">共 {forecastTotal} 词</span>
            </div>
            <ForecastChart forecast={forecast} />
          </div>

          <div className="chart-panel">
            <div className="chart-panel-header">
              <span className="chart-panel-title">学习时段</span>
            </div>
            <HourlyHeatmap hourly={hourly} />
          </div>
        </div>

        {/* Mastery bar */}
        <div className="mastery-section">
          <div className="table-header-row">
            <span className="table-title">掌握进度</span>
            <span className="table-subtitle">
              {dueCount > 0 ? `今日待复习 ${dueCount} 词` : '今日暂无待复习'}
            </span>
          </div>
          <div className="mastery-bar" role="img" aria-label={`已掌握 ${overall.mastered}，学习中 ${overall.learning}，未学 ${overall.fresh}`}>
            {overall.mastered > 0 && <span className="seg mastered" style={{ flex: overall.mastered }} />}
            {overall.learning > 0 && <span className="seg learning" style={{ flex: overall.learning }} />}
            {overall.fresh > 0 && <span className="seg fresh" style={{ flex: overall.fresh }} />}
          </div>
          <div className="mastery-legend">
            <span><i className="dot mastered" />已掌握 {overall.mastered}</span>
            <span><i className="dot learning" />学习中 {overall.learning}</span>
            <span><i className="dot fresh" />未学 {overall.fresh}</span>
          </div>
        </div>

        {/* Difficult words */}
        <div className="table-container">
          <div className="table-header-row">
            <span className="table-title">
              <AlertTriangle size={14} className="inline-icon" /> 易错词
            </span>
            <span className="table-subtitle">错 3 次以上或正确率低于 60%</span>
          </div>
          {difficult.length === 0 ? (
            <div className="table-empty">
              <div className="empty-icon-wrap">
                {overall.learning + overall.mastered === 0 ? <BookOpen size={24} /> : <Sparkles size={24} />}
              </div>
              <p className="empty-text">
                {overall.learning + overall.mastered === 0 ? '还没有学习记录' : '暂无易错词'}
              </p>
              <p className="empty-sub">
                {overall.learning + overall.mastered === 0
                  ? '切换到「模式A / 模式B」答题并提交，就会开始记录每个单词的学习进度'
                  : '继续保持'}
              </p>
            </div>
          ) : (
            <div className="table-scroll-area">
              <table className="modern-table">
                <thead>
                  <tr><th>单词</th><th>释义</th><th>错 / 对</th><th>常见错误</th></tr>
                </thead>
                <tbody>
                  {difficult.map((p) => {
                    const info = wordIndex.get(p.wordId);
                    const mistake = getCommonMistake(p);
                    return (
                      <tr key={p.wordId}>
                        <td><span className="root-pill">{info?.word ?? p.wordId}</span></td>
                        <td className="meaning-col">{info?.meaning}</td>
                        <td className="duration-col">{p.spell.wrong + p.meaning.wrong} / {p.spell.correct + p.meaning.correct}</td>
                        <td className="mistake-col">{mistake ? mistake.answer : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <span className="footer-hint">学习记录自动同步，换个设备也能继续。</span>
          <div className="footer-actions">
            <button className="action-btn-clean" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} /> 导入
            </button>
            <button className="action-btn-clean" onClick={handleExport}>
              <Download size={14} /> 导出备份
            </button>
            <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={handleImport} />
          </div>
        </div>
      </div>
    </div>
  );
};
