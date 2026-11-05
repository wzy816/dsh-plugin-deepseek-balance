/**
 * Client half of the DeepSeek balance / price-period status plugin.
 *
 * One ambient line below the composer card:
 *   Balance ¥17.88 · Granted ¥0.00 · Topped up ¥17.88   • Off-peak · Peak in 00:52:13
 *
 * The Host half computes the snapshot (the peak/off-peak rule, the next switch
 * instant, the wallet balances); this half only renders it, ticks the countdown
 * locally and re-reads the snapshot on a fixed poll and when the switch passes.
 */
window.__ModuleLoader__.load({
	id: 'dsh-plugin-deepseek-balance',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'dsh-plugin-deepseek-balance';
		const ROUTE = '/_dsh/deepseek-balance';
		const POLL_MS = 60000;

		const en = {
			balance: 'Total',
			granted: 'Granted',
			toppedUp: 'Topped up',
			total: 'Total',
			peak: 'Peak',
			offPeak: 'Off-peak',
			loading: 'Reading…',
			unconfigured: 'no API key',
			unavailable: 'unavailable',
			switchTo: '→ {state} in {duration}',
			weekend: 'weekend',
			period: 'Current period',
			nextSwitch: 'Next switch',
			peakWindows: 'Peak windows',
			peakWindowsValue: '01:00–04:00 and 06:00–10:00 UTC, Mon–Fri, excluding Chinese public holidays',
			holidaySource: 'Holiday data',
			holidayReady: 'timor.tech, ready',
			holidayPartial: 'timor.tech, partially available',
			holidayUnavailable: 'timor.tech unavailable — weekday rule only',
			updated: 'Updated',
			refreshHint: 'Click to refresh',
			reasonHoliday: 'Chinese public holiday',
			reasonWeekend: 'Weekend',
			reasonPeakWindow: 'inside a peak window',
			reasonOffPeakWindow: 'outside peak windows',
			holiday_元旦: 'New Year',
			holiday_春节: 'Spring Festival',
			holiday_除夕: 'Lunar New Year Eve',
			holiday_初一: 'Spring Festival',
			holiday_初二: 'Spring Festival',
			holiday_初三: 'Spring Festival',
			holiday_初四: 'Spring Festival',
			holiday_初五: 'Spring Festival',
			holiday_初六: 'Spring Festival',
			holiday_初七: 'Spring Festival',
			holiday_清明节: 'Qingming Festival',
			holiday_劳动节: 'Labour Day',
			holiday_端午节: 'Dragon Boat Festival',
			holiday_中秋节: 'Mid-Autumn Festival',
			holiday_国庆节: 'National Day',
		};

		const zh = {
			balance: '总余额',
			granted: '赠送',
			toppedUp: '充值',
			total: '总余额',
			peak: '峰时',
			offPeak: '谷时',
			loading: '读取中…',
			unconfigured: '未配置密钥',
			unavailable: '读取失败',
			switchTo: '{duration} 后转{state}',
			weekend: '周末',
			period: '当前时段',
			nextSwitch: '下次切换',
			peakWindows: '峰时时段',
			peakWindowsValue: 'UTC 01:00–04:00、06:00–10:00，周一至周五，中国法定节假日除外',
			holidaySource: '节假日数据',
			holidayReady: 'timor.tech 就绪',
			holidayPartial: 'timor.tech 部分可用',
			holidayUnavailable: 'timor.tech 不可用，仅按星期判断',
			updated: '更新于',
			refreshHint: '点击刷新',
			reasonHoliday: '中国法定节假日',
			reasonWeekend: '周末',
			reasonPeakWindow: '峰时窗口内',
			reasonOffPeakWindow: '峰时窗口外',
			holiday_元旦: '元旦',
			holiday_春节: '春节',
			holiday_除夕: '除夕',
			holiday_初一: '初一',
			holiday_初二: '初二',
			holiday_初三: '初三',
			holiday_初四: '初四',
			holiday_初五: '初五',
			holiday_初六: '初六',
			holiday_初七: '初七',
			holiday_清明节: '清明节',
			holiday_劳动节: '劳动节',
			holiday_端午节: '端午节',
			holiday_中秋节: '中秋节',
			holiday_国庆节: '国庆节',
		};


		const CSS = [
			// The dock is a plain block in the host: make it one wrapping strip so this
			// entry can sit at the right edge beside the context meter, on one line.
			'[data-composer-dock]{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:0 2px}',
			'.dsb-root{display:flex;align-items:center;min-width:0;order:1}',
			// Same type scale, color, padding and radius as the shipped stat pills, so the
			// line reads as one more reading in the composer status bar.
			'.dsb-row{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;padding:1px 8px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;font:inherit;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;text-align:left;white-space:nowrap}',
			'.dsb-row:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-secondary)}',
			'.dsb-row:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
			'.dsb-seg{display:inline-flex;align-items:baseline;gap:4px}',
			'.dsb-key,.dsb-val{color:inherit}',
			'.dsb-dot-sep{color:inherit}',
			'.dsb-sep{width:1px;align-self:stretch;min-height:10px;background:var(--dsw-alias-separator-primary,var(--dsw-alias-border-l1))}',
			'.dsb-price{display:inline-flex;align-items:center;gap:5px}',
			'.dsb-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-idle-primary)}',
			'.dsb-dot[data-state="peak"]{background:var(--dsw-alias-state-warn-primary)}',
			'.dsb-dot[data-state="off-peak"]{background:var(--dsw-alias-state-success-primary)}',
			'.dsb-state,.dsb-reason,.dsb-count{color:inherit}',
			'.dsb-count{font-variant-numeric:tabular-nums}',
			'.dsb-flag{flex:none;color:var(--dsw-alias-state-error-primary);cursor:help}',
		].join('\n');

		function pad2(value) {
			return String(value).padStart(2, '0');
		}

		/** `HH:MM:SS`, or `Nd HH:MM:SS` beyond a day. */
		function formatDuration(ms) {
			const total = Math.max(0, Math.floor(ms / 1000));
			const days = Math.floor(total / 86400);
			const hours = Math.floor((total % 86400) / 3600);
			const minutes = Math.floor((total % 3600) / 60);
			const seconds = total % 60;
			const clock = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
			return days > 0 ? `${days}d ${clock}` : clock;
		}

		const SYMBOLS = { CNY: '¥', USD: '$' };

		/** Currency rendering that keeps the API's decimal string. */
		function money(amount, currency) {
			const symbol = SYMBOLS[currency];
			const value = amount === '' ? '—' : amount;
			if (symbol) return `${symbol}${value}`;
			return currency ? `${value} ${currency}` : value;
		}

		/** Total = granted + topped up, in the endpoint's two-decimal scale. */
		function walletTotal(wallet) {
			const granted = Number(wallet.granted);
			const toppedUp = Number(wallet.toppedUp);
			if (!Number.isFinite(granted) || !Number.isFinite(toppedUp)) return wallet.total;
			return (granted + toppedUp).toFixed(2);
		}

		/** Prefer CNY, then USD, then the first wallet. */
		function primaryWallet(wallets) {
			if (!Array.isArray(wallets) || wallets.length === 0) return null;
			const cny = wallets.find((wallet) => wallet.currency === 'CNY');
			if (cny) return cny;
			const usd = wallets.find((wallet) => wallet.currency === 'USD');
			return usd || wallets[0];
		}

		/** Localize a timor.tech holiday name; unknown names stay verbatim. */
		function holidayText(t, name) {
			if (!name) return '';
			const key = `holiday_${name}`;
			const translated = t(key);
			return translated === key ? name : translated;
		}

		function stateLabel(t, state) {
			return state === 'peak' ? t('peak') : t('offPeak');
		}

		function BalanceClock(props) {
			const t = typeof props.t === 'function' ? props.t : (key) => key;
			const [snapshot, setSnapshot] = React.useState(null);
			const [error, setError] = React.useState(null);
			const [, setTick] = React.useState(0);
			const offset = React.useRef(0);
			const disposed = React.useRef(false);
			const inflight = React.useRef(null);

			const load = React.useCallback((refresh) => {
				if (inflight.current) {
					try {
						inflight.current.abort();
					} catch {
						// an already settled request cannot be aborted
					}
				}
				const controller = new AbortController();
				inflight.current = controller;
				fetch(`${ROUTE}${refresh ? '?refresh=1' : ''}`, {
					signal: controller.signal,
					cache: 'no-store',
					headers: { accept: 'application/json' },
				})
					.then((response) => response.json())
					.then((body) => {
						if (disposed.current) return;
						if (!body || body.ok !== true) throw new Error((body && body.error) || 'invalid snapshot');
						const serverNow = Number(body.now);
						if (Number.isFinite(serverNow)) offset.current = serverNow - Date.now();
						setSnapshot(body);
						setError(null);
					})
					.catch((cause) => {
						if (disposed.current) return;
						if (cause && cause.name === 'AbortError') return;
						setError(String((cause && cause.message) || cause));
					});
			}, []);

			React.useEffect(() => {
				disposed.current = false;
				load(false);
				const poll = setInterval(() => load(false), POLL_MS);
				const tick = setInterval(() => setTick((value) => value + 1), 1000);
				return () => {
					disposed.current = true;
					clearInterval(poll);
					clearInterval(tick);
					if (inflight.current) {
						try {
							inflight.current.abort();
						} catch {
							// ignore
						}
					}
				};
			}, [load]);

			const pricing = snapshot && snapshot.pricing ? snapshot.pricing : null;
			const balance = snapshot && snapshot.balance ? snapshot.balance : null;
			const holidayData = snapshot && snapshot.holidayData ? snapshot.holidayData : null;
			const wallets = balance && Array.isArray(balance.wallets) ? balance.wallets : [];
			const wallet = primaryWallet(wallets);
			const now = Date.now() + offset.current;
			const remaining =
				pricing && typeof pricing.nextSwitchAt === 'number' ? Math.max(0, pricing.nextSwitchAt - now) : null;
			const expired = remaining === 0;

			React.useEffect(() => {
				if (!expired) return undefined;
				const timer = setTimeout(() => load(true), 1500);
				return () => clearTimeout(timer);
			}, [expired, load]);

			const ready = balance && balance.status === 'ready' && wallet !== null;
			const state = pricing ? pricing.state : null;
			const holidayName = pricing && pricing.holiday ? holidayText(t, pricing.holiday) : '';
			const weekend = pricing ? pricing.isWeekend === true : false;

			const detail = [];
			if (pricing) {
				detail.push(`${t('period')}: ${stateLabel(t, state)}`);
				if (pricing.reason === 'holiday') detail.push(`${t('reasonHoliday')}: ${holidayName}`);
				else if (pricing.reason === 'weekend') detail.push(t('reasonWeekend'));
				else if (pricing.reason === 'peak-window') detail.push(t('reasonPeakWindow'));
				else detail.push(t('reasonOffPeakWindow'));
				if (typeof pricing.nextSwitchAt === 'number') {
					const at = new Date(pricing.nextSwitchAt);
					detail.push(
						`${t('nextSwitch')}: ${at.toLocaleString()} · ${stateLabel(t, pricing.nextState)} (${formatDuration(
							Math.max(0, pricing.nextSwitchAt - now),
						)})`,
					);
				}
			}
			detail.push(`${t('peakWindows')}: ${t('peakWindowsValue')}`);
			if (holidayData) {
				const status = holidayData.status;
				detail.push(
					`${t('holidaySource')}: ${
						status === 'ready' ? t('holidayReady') : status === 'partial' ? t('holidayPartial') : t('holidayUnavailable')
					}`,
				);
			}
			if (wallets.length > 0) {
				detail.push(
					wallets
						.map(
							(item) =>
								`${item.currency} · ${t('total')} ${money(walletTotal(item), item.currency)} · ${t('granted')} ${money(
									item.granted,
									item.currency,
								)} · ${t('toppedUp')} ${money(item.toppedUp, item.currency)}`,
						)
						.join('\n'),
				);
			}
			if (balance && balance.error) detail.push(`⚠ ${balance.error}`);
			if (balance && balance.status === 'unconfigured') detail.push(`${t('unconfigured')}: ${balance.credentialRef}`);
			if (balance && typeof balance.fetchedAt === 'number') {
				detail.push(`${t('updated')}: ${new Date(balance.fetchedAt).toLocaleTimeString()}`);
			}
			if (error) detail.push(`⚠ ${error}`);
			detail.push(t('refreshHint'));
			const title = detail.join('\n');

			const balanceSegments = [];
			if (ready) {
				balanceSegments.push(
					h(
						'span',
						{ className: 'dsb-seg', key: 'total' },
						h('span', { className: 'dsb-key' }, t('balance')),
						h('span', { className: 'dsb-val' }, money(walletTotal(wallet), wallet.currency)),
					),
				);
				if (wallets.length > 1) {
					balanceSegments.push(h('span', { className: 'dsb-key', key: 'more' }, `+${wallets.length - 1}`));
				}
			} else {
				const label =
					balance && balance.status === 'unconfigured'
						? t('unconfigured')
						: balance && balance.status === 'failed'
							? t('unavailable')
							: t('loading');
				balanceSegments.push(
					h(
						'span',
						{ className: 'dsb-seg', key: 'placeholder' },
						h('span', { className: 'dsb-key' }, t('balance')),
						h('span', { className: 'dsb-val' }, label),
					),
				);
			}

			const priceNode = h(
				'span',
				{ className: 'dsb-price' },
				h('span', { className: 'dsb-dot', 'data-state': state || 'unknown', 'aria-hidden': 'true' }),
				h('span', { className: 'dsb-state' }, state ? stateLabel(t, state) : t('loading')),
				state === 'off-peak' && (holidayName || weekend)
					? h('span', { className: 'dsb-reason' }, `· ${holidayName || t('weekend')}`)
					: null,
				typeof remaining === 'number' && pricing && pricing.nextState
					? h(
							'span',
							{ className: 'dsb-count' },
							t('switchTo', {
								state: stateLabel(t, pricing.nextState),
								duration: formatDuration(remaining),
							}),
						)
					: null,
			);

			const children = [];
			balanceSegments.forEach((segment, index) => {
				if (index > 0) {
					children.push(h('span', { className: 'dsb-dot-sep', key: `sep-${index}`, 'aria-hidden': 'true' }, '·'));
				}
				children.push(segment);
			});
			children.push(h('span', { className: 'dsb-sep', key: 'rule', 'aria-hidden': 'true' }));
			children.push(priceNode);

			return h(
				'div',
				{ className: 'dsb-root' },
				h(
					'button',
					{
						type: 'button',
						className: 'dsb-row',
						title,
						onClick: () => load(true),
					},
					children,
				),
				error ? h('span', { className: 'dsb-flag', title: error }, '!') : null,
			);
		}

		function apply(ctx) {
			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.setAttribute('data-plugin-css', NS);
				tag.textContent = CSS;
				(document.head || document.documentElement).appendChild(tag);
				return () => {
					try {
						tag.remove();
					} catch {
						// the document may be gone during teardown
					}
				};
			}, `${NS}: styles`);

			ctx.effect(() => ctx.locale.register(NS, { en, zh }), `${NS}: dictionaries`);

			ctx.slots.inject('conversation.composer.dock', () =>
				ctx.slots.register(
					{
						name: 'conversation.composer.dock',
						id: 'deepseek-balance',
						order: 2,
						locale: NS,
					},
					BalanceClock,
				),
			);
		}

		return { inject: ['slots', 'locale'], apply };
	},
});
