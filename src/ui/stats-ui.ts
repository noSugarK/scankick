// 战绩 UI（大屏结算与手机「战绩」页共用）：单场个人数据表、累计排行、历史对局
import { endReasonText, resultTitle } from '../game/host-game';
import { TEAM_COLOR } from '../game/render';
import type { EndInfo, PlayerStat } from '../game/types';
import { t } from '../i18n';
import { esc } from './util';

const num = (n: number) => `<td class="${n ? '' : 'z'}">${n}</td>`;

/** 比分 + 结果 + 结束原因，一行 */
export function resultLineHtml(e: EndInfo): string {
  const [a, b] = e.score;
  return `<span class="rs-score"><b style="color:${TEAM_COLOR[0]}">${a}</b> : <b style="color:${TEAM_COLOR[1]}">${b}</b></span>
    <b class="rs-title">${resultTitle(e)}</b><span class="rs-reason">${esc(endReasonText(e))}</span>`;
}

/** 单场个人数据表：按队伍分组，标出 MVP 和自己 */
export function statsTableHtml(e: EndInfo, meId = -1): string {
  const head = `<tr><th></th><th>${t('stats.g')}</th><th>${t('stats.a')}</th><th>${t('stats.s')}</th><th>${t('stats.t')}</th></tr>`;
  const row = (p: PlayerStat) => {
    const mvp = p.id === e.mvp ? `<i class="mvp">MVP</i>` : '';
    const you = p.id === meId ? ` <small>(${t('play.you')})</small>` : '';
    return `<tr class="${p.id === meId ? 'me' : ''}"><td class="nm"><i class="dot" style="background:${TEAM_COLOR[p.team]}"></i>${esc(p.name)}${you}${mvp}</td>${num(p.g)}${num(p.a)}${num(p.s)}${num(p.t)}</tr>`;
  };
  return `<table class="stats"><thead>${head}</thead><tbody>${e.stats.map(row).join('')}</tbody></table>`;
}

interface Total {
  name: string;
  n: number;
  w: number;
  g: number;
  a: number;
  mvp: number;
}

/** 多场累计：只算真人，按昵称合并（同一个人中途离开再回来 id 会变） */
function totalsHtml(list: EndInfo[], myName: string): string {
  const map = new Map<string, Total>();
  for (const e of list) {
    for (const p of e.stats) {
      if (p.bot) continue;
      const r = map.get(p.name) ?? { name: p.name, n: 0, w: 0, g: 0, a: 0, mvp: 0 };
      r.n++;
      if (p.team === e.winner) r.w++;
      r.g += p.g;
      r.a += p.a;
      if (p.id === e.mvp) r.mvp++;
      map.set(p.name, r);
    }
  }
  const rows = [...map.values()].sort((x, y) => y.w - x.w || y.g - x.g || y.a - x.a || y.n - x.n);
  if (!rows.length) return '';
  const head = `<tr><th></th><th>${t('stats.played')}</th><th>${t('stats.wins')}</th><th>${t('stats.g')}</th><th>${t('stats.a')}</th><th>MVP</th></tr>`;
  const body = rows
    .map((r) => `<tr class="${r.name === myName ? 'me' : ''}"><td class="nm">${esc(r.name)}</td>${num(r.n)}${num(r.w)}${num(r.g)}${num(r.a)}${num(r.mvp)}</tr>`)
    .join('');
  return `<table class="stats"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** 手机「战绩」页：最近一场、累计、更早的对局（可展开） */
export function statsTabHtml(list: EndInfo[], meId: number, myName: string): string {
  if (!list.length) return `<p class="cfg-summary">${t('stats.empty')}</p>`;
  const [last, ...older] = list;
  let html = `<div class="st-sec"><div class="st-title">${t('stats.last')} · ${clock(last.at)}</div>${statsTableHtml(last, meId)}</div>`;
  if (list.length > 1) html += `<div class="st-sec"><div class="st-title">${t('stats.total', { n: list.length })}</div>${totalsHtml(list, myName)}</div>`;
  if (older.length) {
    html += `<div class="st-sec"><div class="st-title">${t('stats.history')}</div>${older
      .map((e) => `<details class="st-old"><summary>${clock(e.at)} ${resultLineHtml(e)}</summary>${statsTableHtml(e, -1)}</details>`)
      .join('')}</div>`;
  }
  return html;
}

/** 本场最佳一行（大屏结算用） */
export function mvpLineHtml(e: EndInfo): string {
  const p = e.stats.find((s) => s.id === e.mvp);
  if (!p) return '';
  const parts = [p.g && `${p.g} ${t('stats.g')}`, p.a && `${p.a} ${t('stats.a')}`, p.t && `${p.t} ${t('stats.t')}`].filter(Boolean);
  return `<p class="mvp-line"><i class="mvp">MVP</i> <b style="color:${TEAM_COLOR[p.team]}">${esc(p.name)}</b> <span class="muted">${parts.join(' · ')}</span></p>`;
}
