import { m as memo, g as getNextElement, t as template, a as getNextMarker, i as insert } from "./web-BrXyZ-Hv.js";
import { i as initClient, c as contract, C as Core, p as pkg, a as pkg$1, b as pkg$2, d as pkg$3, e as pkg$4, f as pkg$5, g as pkg$6, h as pkg$7, j as pkg$8, k as pkg$9, l as pkg$a, m as pkg$b, n as pkg$c, o as pkg$d, q as pkg$e, r as pkg$f, s as pkg$g, t as pkg$h, u as pkg$i, v as pkg$j, w as deserializeProject, x as parse, P as Project, y as PlatformContext, I as Interface, z as ConnectionsDialog, A as ConfigDialog, B as IconPhExport, D as serializeProject, E as IconIcRoundShare } from "./round-share-PHSh5hL2.js";
import { e as createSignal, k as onMount, b as createComponent, S as Show } from "./solid-COykZtSy.js";
import { t as toast } from "./index-DDhwvyeJ.js";
import { s as savePlaygroundProject, f as fetchPlaygroundProject } from "./api-Bu41SY_-.js";
import { I as IconSvgSpinners90Ring } from "./90-ring-BiYmYKPE.js";
import { o as useSearchParams } from "./routing-DEHGCM-R.js";
import { B as Button, A as AsyncButton } from "./button-BRzb2Wkz.js";
import { u as useAction } from "./action-EmZbM2bN.js";
import "./dialog-C7UN_-MB.js";
import "./ZUHR2BAH-DeUuezxO.js";
import "./R5675YMU-C6EXqLl_.js";
import "./dots-horizontal-2azE2fYH.js";
import "./index-Canl0i0r.js";
import "./store-12zX8qse.js";
import "./preload-helper-DPb_hSpc.js";
import "./json-ZCfGR0vq.js";
import "./createAsync-DflW-LI1.js";
var _tmpl$ = /* @__PURE__ */ template(`<div class="w-full h-full flex flex-col items-center justify-center text-neutral-300 gap-4"><span>Loading project</span> <!$><!/>`);
const AUTH_URL = "/auth";
const api = initClient(contract, {
  baseUrl: "api",
  baseHeaders: {}
});
const core = new Core({
  fetch,
  oauth: {
    authorize: async (provider) => {
      const loginWindow = window.open(`${AUTH_URL}/${provider}/login?${new URLSearchParams({
        state: window.btoa(JSON.stringify({
          env: "web",
          targetOrigin: window.origin
        }))
      })}`);
      if (!loginWindow) {
        return null;
      }
      return await new Promise((res) => window.addEventListener("message", (e) => {
        if (e.source !== loginWindow) return;
        res({
          ...e.data,
          issued_at: Date.now() / 1e3
        });
      }));
    },
    refresh: async (provider, refreshToken) => {
      const res = await fetch(`${AUTH_URL}/${provider}/refresh`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          refreshToken
        })
      });
      return {
        ...await res.json(),
        issued_at: Date.now() / 1e3
      };
    }
  },
  api
});
[pkg, pkg$1, pkg$2, pkg$3, pkg$4, pkg$5, pkg$6, pkg$7, pkg$8, pkg$9, pkg$a, pkg$b, pkg$c, pkg$d, pkg$e, pkg$f, pkg$g, pkg$h, pkg$i, pkg$j].map((p) => p && core.registerPackage(p));
const Editor = () => {
  const [loaded, setLoaded] = createSignal(false);
  const [params] = useSearchParams();
  onMount(async () => {
    if (params.shared) {
      fetchPlaygroundProject(params.shared).then((projectStr) => {
        if (projectStr) core.load((c) => deserializeProject(c, parse(Project, JSON.parse(projectStr))));
      }).finally(() => {
        setLoaded(true);
      });
    } else {
      const savedProject = localStorage.getItem("project");
      if (savedProject) {
        try {
          await core.load((c) => deserializeProject(c, parse(Project, JSON.parse(savedProject))));
        } catch {
        }
      }
      setLoaded(true);
    }
  });
  return createComponent(Show, {
    get when() {
      return memo(() => !!loaded())() && core.project;
    },
    keyed: true,
    get fallback() {
      return (() => {
        var _el$ = getNextElement(_tmpl$), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling, _el$4 = _el$3.nextSibling, [_el$5, _co$] = getNextMarker(_el$4.nextSibling);
        insert(_el$, createComponent(IconSvgSpinners90Ring, {
          "class": "size-12"
        }), _el$5, _co$);
        return _el$;
      })();
    },
    get children() {
      return createComponent(PlatformContext.Provider, {
        get value() {
          return {
            clipboard: navigator.clipboard ? {
              readText: navigator.clipboard.readText,
              writeText: navigator.clipboard.writeText
            } : void 0
          };
        },
        get children() {
          return createComponent(Interface, {
            core,
            environment: "browser"
          });
        }
      });
    }
  });
};
function ConnectionsDialogButton() {
  return [createComponent(ConnectionsDialog, {
    core
  }), createComponent(ConfigDialog, {})];
}
function ProjectName() {
  return memo(() => core.project.name);
}
function ExportButton() {
  return createComponent(Button, {
    size: "icon",
    variant: "ghost",
    title: "Export Project",
    onClick: () => saveJsonAsFile("project.json", serializeProject(core.project)),
    get children() {
      return createComponent(IconPhExport, {
        "class": "size-5"
      });
    }
  });
}
function ShareButton() {
  const createProjectLink = useAction(savePlaygroundProject);
  return createComponent(AsyncButton, {
    size: "icon",
    variant: "ghost",
    title: "Share Project",
    onClick: async () => {
      const id = await createProjectLink(JSON.stringify(serializeProject(core.project)));
      navigator.clipboard.writeText(new URL(`/playground?${new URLSearchParams({
        shared: id
      })}`, location.origin).toString());
      toast("Project link copied to clipboard");
    },
    get children() {
      return createComponent(IconIcRoundShare, {
        "class": "size-5"
      });
    }
  });
}
function saveJsonAsFile(filename, dataObjToWrite) {
  const blob = new Blob([JSON.stringify(dataObjToWrite)], {
    type: "text/json"
  });
  const link = document.createElement("a");
  link.download = filename;
  link.href = window.URL.createObjectURL(blob);
  link.dataset.downloadurl = ["application/json", link.download, link.href].join(":");
  const evt = new MouseEvent("click", {
    view: window,
    bubbles: true,
    cancelable: true
  });
  link.dispatchEvent(evt);
  link.remove();
}
export {
  ConnectionsDialogButton,
  ExportButton,
  ProjectName,
  ShareButton,
  api,
  Editor as default
};
