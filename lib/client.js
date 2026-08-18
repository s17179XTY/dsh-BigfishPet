// bigfish-pet client bundle: "桌宠" settings card, dsh-dafeiyu style.
// Card layout (label + hint left, control right), every change saves
// immediately (sliders debounced 250ms). The pet window is an
// always-on-top shaped window owned by the Bigfish Electron shell, driven
// by ~/.dsh/pet.json; this card edits that file.
// Hand-written __ModuleLoader__ factory (no build step).
window.__ModuleLoader__.load({ id: "bigfish-pet", factory: (require) => {

	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	let react = require("react");
	const h = react.createElement;
	const { useState, useEffect, useRef } = react;

	const name = "bigfish-pet";
	const inject = ["slots"];

	// ---------------------------------------------------------------------
	// API
	// ---------------------------------------------------------------------
	function fetchState() {
		return fetch("/bigfish-pet/state", { cache: "no-store" })
			.then((res) => { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); });
	}
	function postState(patch) {
		return fetch("/bigfish-pet/state", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(patch),
		}).then((res) => { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); });
	}

	// ---------------------------------------------------------------------
	// dsh-dafeiyu style: card + Field(label/hint left, control right),
	// every change persists immediately; sliders are debounced.
	// ---------------------------------------------------------------------
	const CARD_STYLE = {
		listStyle: "none",
		border: "1px solid var(--border-color, #d8d8d8)",
		borderRadius: 12,
		padding: 16,
		background: "var(--surface-color, transparent)",
		display: "grid",
		gap: 14,
		maxWidth: 620,
	};
	const ROW_STYLE = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 20 };
	const SELECT_STYLE = { minWidth: 120, padding: "6px 10px", borderRadius: 8, background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.4)" };
	const INPUT_STYLE = { minWidth: 140, padding: "6px 10px", borderRadius: 8, background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.4)" };
	const BUBBLE_STATE_OPTIONS = [
		["IDLE", "空闲"],
		["THINKING", "思考中"],
		["WORKING", "工作中"],
		["WAITING", "等待确认"],
		["SUCCESS", "完成"],
		["ERROR", "错误"],
	];
	const BUBBLE_GRID_STYLE = {
		display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: "6px 14px",
		padding: "10px 12px", border: "1px solid var(--border-color, #d8d8d8)", borderRadius: 8,
	};

	function Field({ label, hint, children }) {
		return h("label", { style: ROW_STYLE },
			h("span", null,
				h("span", { style: { display: "block", fontWeight: 600 } }, label),
				h("small", { style: { display: "block", opacity: 0.65, marginTop: 3 } }, hint)),
			children);
	}

	function BubbleStatePicker({ value, disabled, onChange }) {
		const selected = Array.isArray(value) ? value : [];
		const toggle = (state, checked) => {
			const next = new Set(selected);
			if (checked) next.add(state); else next.delete(state);
			onChange([...next]);
		};
		return h("div", { style: BUBBLE_GRID_STYLE },
			BUBBLE_STATE_OPTIONS.map(([state, label]) =>
				h("label", { key: state, style: { display: "flex", alignItems: "center", gap: 4 } },
					h("input", {
						type: "checkbox", checked: selected.includes(state), disabled,
						onChange: (event) => toggle(state, event.target.checked),
					}),
					label)));
	}

	function PetSettings() {
		const [state, setState] = useState(null);
		const [busy, setBusy] = useState(false);
		const [notice, setNotice] = useState("");
		const patchSeq = useRef(0);
		const sliderTimers = useRef(new Map());

		useEffect(() => {
			let active = true;
			fetchState()
				.then((s) => { if (active) setState(s); })
				.catch((error) => { if (active) setNotice("读取失败: " + error.message); });
			return () => {
				active = false;
				for (const timer of sliderTimers.current.values()) clearTimeout(timer);
				sliderTimers.current.clear();
			};
		}, []);

		if (!state) return h("p", { style: { opacity: 0.65 } }, "加载中…");

		// Immediate save; a stale response may not overwrite a newer one.
		const write = async (patch, okText) => {
			const seq = ++patchSeq.current;
			setBusy(true);
			setNotice("");
			try {
				const next = await postState(patch);
				if (seq === patchSeq.current) { setState(next); setNotice(okText || "已保存"); }
			} catch (error) {
				if (seq === patchSeq.current) setNotice("保存失败: " + error.message);
			} finally {
				if (seq === patchSeq.current) setBusy(false);
			}
		};
		// Optimistic local update + debounced save (used by sliders/inputs).
		const debouncedWrite = (field, patchBuilder, delay = 250) => (event) => {
			const value = event.target.value;
			patchSeq.current += 1;
			setState((prev) => {
				const updated = JSON.parse(JSON.stringify(prev));
				const keys = field.split(".");
				let cursor = updated;
				for (let i = 0; i < keys.length - 1; i++) cursor = cursor[keys[i]];
				cursor[keys[keys.length - 1]] = event.target.type === "number" || event.target.type === "range" ? Number(value) : value;
				return updated;
			});
			const pending = sliderTimers.current.get(field);
			if (pending) clearTimeout(pending);
			const timer = setTimeout(() => {
				sliderTimers.current.delete(field);
				void write(patchBuilder(event.target.type === "number" || event.target.type === "range" ? Number(value) : value));
			}, delay);
			sliderTimers.current.set(field, timer);
		};

		const display = state.display || {};
		const sizePx = Math.max(80, Math.min(280, Number(display.size) || 160));
		const sizePct = Math.round((sizePx - 80) / 200 * 100);
		const bubbleMode = state.bubbleMode || "always";
		const activity = state.activity || "normal";
		const walkCooldown = Number(state.walkCooldownMin) || 3;

		return h("li", { style: CARD_STYLE, "data-testid": "bigfish-pet-settings" },
			h("div", null,
				h("strong", { style: { fontSize: 16 } }, "桌宠（鲸鱼娘）"),
				h("p", { style: { margin: "5px 0 0", opacity: 0.72 } }, "入口和状态属于 DSH，宠物始终显示在 Windows 桌面最上层，跟随真实任务状态（思考/工作/等待/完成/出错）。")),

			h(Field, { label: "显示桌宠", hint: "关闭后宠物窗口立即隐藏。" },
				h("input", {
					type: "checkbox", checked: Boolean(display.visible), disabled: busy,
					onChange: (event) => void write({ display: { visible: event.target.checked } }),
				})),

			h(Field, { label: "角色大小", hint: `${Math.round(sizePct)}%` },
				h("input", {
					type: "range", min: 80, max: 280, step: 4, value: sizePx, disabled: busy,
					style: { flex: 1, minWidth: 120 },
					onChange: debouncedWrite("display.size", (v) => ({ display: { size: v } })),
				})),

			h(Field, { label: "气泡大小", hint: `${Math.round((state.bubbleScale || 1) * 100)}%` },
				h("input", {
					type: "range", min: 0.8, max: 1.2, step: 0.05, value: state.bubbleScale || 1, disabled: busy,
					style: { flex: 1, minWidth: 120 },
					onChange: debouncedWrite("bubbleScale", (v) => ({ bubbleScale: v })),
				})),

			h(Field, { label: "气泡显示", hint: "常驻显示、完全隐藏，或自定义哪些状态显示气泡。" },
				h("select", {
					value: bubbleMode, disabled: busy, style: SELECT_STYLE,
					onChange: (event) => void write({ bubbleMode: event.target.value }),
				},
				h("option", { value: "always" }, "常驻显示"),
				h("option", { value: "hidden" }, "完全隐藏"),
				h("option", { value: "custom" }, "自定义显示状态"))),

			bubbleMode === "custom"
				? h(Field, { label: "自定义显示状态", hint: "勾选后，只有这些状态出现时才会显示气泡。" },
					h(BubbleStatePicker, {
						value: state.bubbleStates || ["THINKING", "WORKING", "WAITING", "SUCCESS", "ERROR"],
						disabled: busy,
						onChange: (next) => void write({ bubbleStates: next }),
					}))
				: null,

			h(Field, { label: "活跃程度", hint: "控制空闲时呼吸等微动作的出现频率。" },
				h("select", {
					value: activity, disabled: busy, style: SELECT_STYLE,
					onChange: (event) => void write({ activity: event.target.value }),
				},
				h("option", { value: "quiet" }, "安静"),
				h("option", { value: "normal" }, "标准"),
				h("option", { value: "lively" }, "活泼"))),

			h(Field, { label: "走动冷却", hint: "鼠标方向走动的最小间隔。" },
				h("select", {
					value: String(walkCooldown), disabled: busy, style: SELECT_STYLE,
					onChange: (event) => void write({ walkCooldownMin: Number(event.target.value) }),
				},
				h("option", { value: "0" }, "关闭走动"),
				h("option", { value: "1" }, "1 分钟"),
				h("option", { value: "3" }, "3 分钟"),
				h("option", { value: "5" }, "5 分钟"),
				h("option", { value: "10" }, "10 分钟"))),

			h(Field, { label: "减少动态效果", hint: "减少走动、循环帧和程序化晃动。" },
				h("input", {
					type: "checkbox", checked: state.reducedMotion === true, disabled: busy,
					onChange: (event) => void write({ reducedMotion: event.target.checked }),
				})),

			h(Field, { label: "响应子 Agent", hint: "默认只跟随顶层任务，避免状态过度跳动。" },
				h("input", {
					type: "checkbox", checked: state.includeSubagents === true, disabled: busy,
					onChange: (event) => void write({ includeSubagents: event.target.checked }),
				})),

			h(Field, { label: "名字", hint: "宠物名字。" },
				h("input", {
					value: state.name || "", maxLength: 20, disabled: busy, style: INPUT_STYLE,
					onChange: debouncedWrite("name", (v) => ({ name: v }), 400),
				})),

			h(Field, { label: "任务完成提醒", hint: "任务跑完时宠物气泡提醒。" },
				h("input", {
					type: "checkbox", checked: Boolean(state.notify && state.notify.complete), disabled: busy,
					onChange: (event) => void write({ notify: { complete: event.target.checked } }),
				})),

			h(Field, { label: "位置", hint: "重置为默认位置（右下角）。" },
				h("button", {
					disabled: busy,
					style: { padding: "6px 16px", borderRadius: 8, border: "1px solid rgba(128,128,128,0.4)", background: "transparent", color: "inherit", cursor: "pointer" },
					onClick: () => void write({ display: { visible: true, size: 160, right: 24, bottom: 24 } }, "已重置位置"),
				}, "重置位置")),

			statusBlock(state),
			notice ? h("small", { role: "status", style: { opacity: 0.8 } }, notice) : null,
		);
	}

	function statusBlock(state) {
		const status = state.status || {};
		const STATE_LABELS = { IDLE: "空闲", THINKING: "思考", WORKING: "工作", WAITING: "等待确认", SUCCESS: "完成", ERROR: "出错" };
		const stateLabel = STATE_LABELS[status.state] || status.state || "—";
		const progress = status.progress && status.progress.total
			? "已完成 " + status.progress.completed + "/" + status.progress.total + " 步"
			: "—";
		return h("div", { style: { marginTop: "4px", padding: "12px 14px", borderRadius: 8, border: "1px solid rgba(128,128,128,0.25)", fontSize: 13, lineHeight: 1.8, display: "grid", gridTemplateColumns: "auto auto", gap: "2px 24px", width: "max-content" } },
			h("span", { style: { opacity: 0.75 } }, "名字"), h("span", {}, state.name || "—"),
			h("span", { style: { opacity: 0.75 } }, "状态"), h("span", {}, stateLabel + (status.stage ? "（" + status.stage + "）" : "")),
			h("span", { style: { opacity: 0.75 } }, "当前任务"), h("span", {}, status.task || "—"),
			h("span", { style: { opacity: 0.75 } }, "进度"), h("span", {}, progress),
			h("span", { style: { opacity: 0.75 } }, "项目"), h("span", {}, status.project || "—"),
			h("span", { style: { opacity: 0.75 } }, "气泡文案"), h("span", {}, (status.message || "—") + (status.detail ? " · " + status.detail : "")));
	}

	// ---------------------------------------------------------------------
	// Registration
	// ---------------------------------------------------------------------
	function apply(ctx) {
		ctx.slots.inject("settings.section", () => ctx.slots.register({
			name: "settings.section",
			id: "bigfish-pet",
			order: 25,
			label: () => "桌宠",
		}, () => h(PetSettings, null)));
	}

	exports.name = name;
	exports.inject = inject;
	exports.apply = apply;
	return module.exports;
}
});
