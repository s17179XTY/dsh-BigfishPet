// bigfish-pet client bundle: "桌宠" settings page.
// The pet itself is an always-on-top floating window owned by the Bigfish
// Electron shell, driven by ~/.dsh/pet.json; this page edits that file
// (draft-based, committed by the 保存 button).
// Hand-written __ModuleLoader__ factory (no build step). The only external
// require is react, which the loader module table provides.
window.__ModuleLoader__.load({ id: "bigfish-pet", factory: (require) => {

	var module = { exports: {} };
	var exports = module.exports;
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	let react = require("react");
	const h = react.createElement;
	const { useState, useEffect, useCallback } = react;

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
	// PetSettings — registered in settings.section
	// Draft-based: edits collect locally, one 保存 button commits them.
	// ---------------------------------------------------------------------
	const ROW_STYLE = { display: "flex", alignItems: "center", gap: "10px", marginTop: "8px", fontSize: "13px" };
	const LABEL_STYLE = { width: "120px", flexShrink: 0, opacity: 0.85 };
	const INPUT_STYLE = {
		padding: "5px 9px",
		borderRadius: "6px",
		border: "1px solid rgba(128,128,128,0.35)",
		background: "transparent",
		color: "inherit",
		fontSize: "13px",
	};
	const BUTTON_STYLE = {
		padding: "6px 16px",
		borderRadius: "6px",
		border: "none",
		cursor: "pointer",
		fontSize: "13px",
		background: "var(--accent, #2f81f7)",
		color: "#fff",
	};

	function PetSettings() {
		const [state, setState] = useState(null);   // last committed state
		const [draft, setDraft] = useState(null);   // editable form
		const [busy, setBusy] = useState(false);
		const [notice, setNotice] = useState("");

		const load = useCallback(() => {
			fetchState()
				.then((s) => { setState(s); setDraft(JSON.parse(JSON.stringify(s))); })
				.catch((error) => setNotice("读取失败: " + error.message));
		}, []);
		useEffect(load, [load]);

		if (!state || !draft) return h("p", { style: { opacity: 0.65 } }, "加载中…");

		const display = draft.display;
		const dirty = JSON.stringify(state) !== JSON.stringify(draft);
		const currentSizePct = ((Math.max(80, Math.min(280, Number(display.size) || 160)) - 80) / 200) * 100;

		function setField(path, value) {
			setDraft((d) => {
				const next = JSON.parse(JSON.stringify(d));
				const keys = path.split(".");
				let cursor = next;
				for (let i = 0; i < keys.length - 1; i++) cursor = cursor[keys[i]];
				cursor[keys[keys.length - 1]] = value;
				return next;
			});
		}

		function save() {
			setBusy(true);
			setNotice("");
			postState({
				name: draft.name,
				display: { visible: display.visible, size: display.size, right: display.right, bottom: display.bottom },
				notify: { complete: Boolean(draft.notify && draft.notify.complete) },
				activity: draft.activity || "normal",
			})
				.then((next) => { setState(next); setDraft(JSON.parse(JSON.stringify(next))); setNotice("已保存"); })
				.catch((error) => setNotice("保存失败: " + error.message))
				.finally(() => setBusy(false));
		}

		return h("div", { style: { maxWidth: "560px" } },
			h("p", { style: { marginTop: 0, opacity: 0.75, fontSize: "13px" } },
				"桌宠是置顶的独立小窗口，会一直浮在桌面上（Bigfish 隐藏也不消失）。它会跟随 DeepSeek Harness 的真实任务状态（思考/工作/等待/完成/出错），并显示当前阶段与待办进度。可以直接拖动它，也可以在设置里调整；修改后点击「保存」生效，设置保存在 ~/.dsh/pet.json。右键宠物可显示/隐藏 Bigfish。"),

			h("div", { style: ROW_STYLE },
				h("span", { style: LABEL_STYLE }, "显示桌宠"),
				h("input", {
					type: "checkbox",
					checked: Boolean(display.visible),
					disabled: busy,
					onChange: (event) => setField("display.visible", event.target.checked),
				})),

			h("div", { style: ROW_STYLE },
				h("span", { style: LABEL_STYLE }, "大小"),
				h("input", {
					type: "range",
					min: 80,
					max: 280,
					step: 4,
					value: display.size || 160,
					disabled: busy,
					onChange: (event) => setField("display.size", Number(event.target.value)),
					style: { flex: 1 },
				}),
				h("span", { style: { width: "48px", textAlign: "right", opacity: 0.8 } }, (display.size || 160) + "px")),

			h("div", { style: { marginLeft: "120px", marginTop: "2px", paddingRight: "48px" } },
				h("div", { style: { position: "relative", height: "24px" } },
					[80, 120, 160, 200, 240, 280].map((v) => {
						const pct = ((v - 80) / 200) * 100;
						const isDefault = v === 160;
						return h("div", { key: v, style: { position: "absolute", left: pct + "%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center" } },
							h("div", { style: { width: "1px", height: isDefault ? "13px" : "6px", background: isDefault ? "rgba(255,255,255,0.9)" : "rgba(128,128,128,0.55)" } }),
							h("span", { style: { fontSize: "10px", opacity: isDefault ? 0.95 : 0.55, whiteSpace: "nowrap" } }, isDefault ? "默认 160" : String(v)));
					}),
					h("div", { style: { position: "absolute", top: "1px", left: currentSizePct + "%", transform: "translateX(-50%)", width: "3px", height: "15px", background: "var(--accent, #2f81f7)", borderRadius: "2px" } }),
				),
				h("div", { style: { fontSize: "11px", opacity: 0.6, marginTop: "2px" } },
					"蓝色标记 = 当前大小；「默认 160」是鲸鱼娘的初始大小。"),
			),

			h("div", { style: ROW_STYLE },
				h("span", { style: LABEL_STYLE }, "距右边缘"),
				h("input", {
					type: "number",
					min: 0,
					value: display.right,
					disabled: busy,
					style: Object.assign({}, INPUT_STYLE, { width: "90px" }),
					onChange: (event) => setField("display.right", Number(event.target.value) || 0),
				}),
				h("span", { style: { opacity: 0.7 } }, "px")),

			h("div", { style: ROW_STYLE },
				h("span", { style: LABEL_STYLE }, "距底部"),
				h("input", {
					type: "number",
					min: 0,
					value: display.bottom,
					disabled: busy,
					style: Object.assign({}, INPUT_STYLE, { width: "90px" }),
					onChange: (event) => setField("display.bottom", Number(event.target.value) || 0),
				}),
				h("span", { style: { opacity: 0.7 } }, "px")),

			h("div", { style: ROW_STYLE },
				h("span", { style: LABEL_STYLE }, "名字"),
				h("input", {
					value: draft.name || "",
					maxLength: 20,
					disabled: busy,
					style: Object.assign({}, INPUT_STYLE, { width: "160px" }),
					onChange: (event) => setField("name", event.target.value),
				})),

			h("div", { style: ROW_STYLE },
				h("span", { style: LABEL_STYLE }, "任务完成提醒"),
				h("input", {
					type: "checkbox",
					checked: Boolean(draft.notify && draft.notify.complete),
					disabled: busy,
					onChange: (event) => setField("notify.complete", event.target.checked),
				}),
				h("span", { style: { opacity: 0.6, fontSize: "12px" } }, "任务跑完时宠物气泡提醒")),

			h("div", { style: ROW_STYLE },
				h("span", { style: LABEL_STYLE }, "活跃程度"),
				h("div", { style: { display: "flex", gap: "8px" } },
					["quiet", "normal", "lively"].map((v) => {
						const active = (draft.activity || "normal") === v;
						return h("button", {
							key: v,
							disabled: busy,
							onClick: () => setField("activity", v),
							style: Object.assign({}, BUTTON_STYLE, {
								padding: "4px 14px",
								background: active ? "var(--accent, #2f81f7)" : "transparent",
								color: active ? "#fff" : "inherit",
								border: "1px solid rgba(128,128,128,0.4)",
							}),
						}, v === "quiet" ? "安静" : v === "lively" ? "活泼" : "标准");
					})),
				h("span", { style: { opacity: 0.6, fontSize: "12px" } }, "空闲呼吸与走动灵敏度")),

			h("div", { style: Object.assign({}, ROW_STYLE, { marginTop: "16px" }) },
				h("button", Object.assign({}, BUTTON_STYLE, { background: "transparent", color: "inherit", border: "1px solid rgba(128,128,128,0.4)", disabled: busy, onClick: () => { setField("display.visible", true); setField("display.size", 160); setField("display.right", 24); setField("display.bottom", 24); setNotice("已重置，点「保存」生效"); } }), "重置位置")),

			h("div", { style: Object.assign({}, ROW_STYLE, { marginTop: "18px" }) },
				h("button", Object.assign({}, BUTTON_STYLE, {
					disabled: busy || !dirty,
					opacity: busy || !dirty ? 0.55 : 1,
					onClick: save,
				}), "保存"),
				h("span", { style: { opacity: 0.6, fontSize: "12px" } }, dirty ? "有未保存的修改" : "所有修改已保存"),
				notice ? h("span", { style: { fontSize: "13px", opacity: 0.9 } }, notice) : null),

			statusBlock(state),
		);
	}

	function statusBlock(state) {
		const status = state.status || {};
		const STATE_LABELS = { IDLE: "空闲", THINKING: "思考", WORKING: "工作", WAITING: "等待确认", SUCCESS: "完成", ERROR: "出错" };
		const stateLabel = STATE_LABELS[status.state] || status.state || "—";
		const progress = status.progress && status.progress.total
			? "已完成 " + status.progress.completed + "/" + status.progress.total + " 步"
			: "—";
		return h("div", { style: { marginTop: "16px", padding: "12px 14px", borderRadius: "8px", border: "1px solid rgba(128,128,128,0.25)", fontSize: "13px", lineHeight: 1.8, display: "grid", gridTemplateColumns: "auto auto", gap: "2px 24px", width: "max-content" } },
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
