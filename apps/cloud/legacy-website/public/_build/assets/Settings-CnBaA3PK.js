import { g as getNextElement, t as template, i as insert, a as getNextMarker } from "./web-Dl2sEcME.js";
import { Q as tooltip_exports } from "./round-share-4IwrIuPI.js";
import { b as createComponent, S as Show, F as For, n as Switch, M as Match, h as Suspense } from "./solid-COykZtSy.js";
import { c as createAsync } from "./createAsync-DflW-LI1.js";
import { A as AsyncButton, B as Button } from "./button-dTk4F7f6.js";
import "./dialog-Cl8aIpB7.js";
import "./ZUHR2BAH-DciGzthU.js";
import "./R5675YMU-C6EXqLl_.js";
import "./dots-horizontal-ZGk_uH4H.js";
import "./index-Canl0i0r.js";
import "./store-12zX8qse.js";
import "./index-Dic9SOHc.js";
import "./preload-helper-DPb_hSpc.js";
import "./json-ZCfGR0vq.js";
var _tmpl$ = /* @__PURE__ */ template(`<ul class="flex flex-col mb-2 space-y-2">`), _tmpl$2 = /* @__PURE__ */ template(`<span class="text-sm text-gray-300">Access more accounts by <a class=underline href=/credentials target=external>adding credentials`), _tmpl$3 = /* @__PURE__ */ template(`<span>`), _tmpl$4 = /* @__PURE__ */ template(`<li><div class="flex flex-row items-center justify-between"><!$><!/><!$><!/></div><!$><!/>`), _tmpl$5 = /* @__PURE__ */ template(`<span>EventSub Disconnected`), _tmpl$6 = /* @__PURE__ */ template(`<span>EventSub Connected`), _tmpl$7 = /* @__PURE__ */ template(`<span>Chat Connected`), _tmpl$8 = /* @__PURE__ */ template(`<span>Chat Disconnected`), _tmpl$9 = /* @__PURE__ */ template(`<div class=space-y-2><div class=space-x-2></div><div class=space-x-2>`);
const Settings = ({
  core,
  auth,
  eventSub,
  chat,
  persisted: [, setPersisted]
}) => {
  const credentials = createAsync(() => core.getCredentials());
  return createComponent(Suspense, {
    get children() {
      return [(() => {
        var _el$ = getNextElement(_tmpl$);
        insert(_el$, createComponent(Show, {
          get when() {
            return credentials();
          },
          children: (creds) => createComponent(For, {
            get each() {
              return creds().filter((cred) => cred.provider === "twitch");
            },
            children: (cred) => {
              const account = () => auth.accounts.get(cred.id);
              return (() => {
                var _el$3 = getNextElement(_tmpl$4), _el$4 = _el$3.firstChild, _el$6 = _el$4.firstChild, [_el$7, _co$] = getNextMarker(_el$6.nextSibling), _el$8 = _el$7.nextSibling, [_el$9, _co$2] = getNextMarker(_el$8.nextSibling), _el$0 = _el$4.nextSibling, [_el$1, _co$3] = getNextMarker(_el$0.nextSibling);
                insert(_el$4, createComponent(tooltip_exports.Root, {
                  get children() {
                    return [createComponent(tooltip_exports.Trigger, {
                      get children() {
                        var _el$5 = getNextElement(_tmpl$3);
                        insert(_el$5, () => cred.displayName);
                        return _el$5;
                      }
                    }), createComponent(tooltip_exports.Portal, {
                      get children() {
                        return createComponent(tooltip_exports.Content, {
                          "class": "bg-neutral-900 text-white border border-neutral-400 px-2 py-1 rounded",
                          get children() {
                            return createComponent(tooltip_exports.Arrow, {});
                          }
                        });
                      }
                    })];
                  }
                }), _el$7, _co$);
                insert(_el$4, createComponent(Show, {
                  get when() {
                    return account();
                  },
                  get children() {
                    return createComponent(Button, {
                      onClick: () => auth.disableAccount(cred.id),
                      children: "Disable"
                    });
                  },
                  get fallback() {
                    return createComponent(AsyncButton, {
                      onClick: () => auth.enableAccount(cred.id),
                      loadingChildren: "Enabling...",
                      children: "Enable"
                    });
                  }
                }), _el$9, _co$2);
                insert(_el$3, createComponent(Show, {
                  get when() {
                    return account()?.();
                  },
                  children: (account2) => {
                    const eventSubSocket = () => eventSub.sockets.get(account2().data.id);
                    const chatClient = () => chat.clients.get(account2().data.id);
                    return (() => {
                      var _el$10 = getNextElement(_tmpl$9), _el$11 = _el$10.firstChild, _el$14 = _el$11.nextSibling;
                      insert(_el$11, createComponent(Switch, {
                        fallback: "EventSub Connecting...",
                        get children() {
                          return [createComponent(Match, {
                            get when() {
                              return !eventSubSocket();
                            },
                            get children() {
                              return [getNextElement(_tmpl$5), createComponent(AsyncButton, {
                                loadingChildren: "Connecting...",
                                onClick: () => {
                                  setPersisted(account2().data.id, {
                                    eventsub: true
                                  });
                                  return eventSub.connectSocket(account2().data.id);
                                },
                                children: "Connect"
                              })];
                            }
                          }), createComponent(Match, {
                            get when() {
                              return eventSubSocket();
                            },
                            get children() {
                              return [getNextElement(_tmpl$6), createComponent(Button, {
                                onClick: () => {
                                  eventSub.disconnectSocket(account2().data.id);
                                  setPersisted(account2().data.id, {
                                    eventsub: false
                                  });
                                },
                                children: "Disconnect"
                              })];
                            }
                          })];
                        }
                      }));
                      insert(_el$14, createComponent(Switch, {
                        fallback: "Chat Connecting...",
                        get children() {
                          return [createComponent(Match, {
                            get when() {
                              return chatClient()?.status === "connected";
                            },
                            get children() {
                              return [getNextElement(_tmpl$7), createComponent(AsyncButton, {
                                onClick: () => {
                                  setPersisted(account2().data.id, {
                                    chat: false
                                  });
                                  return chat.disconnectClient(account2());
                                },
                                loadingChildren: "Disconnecting...",
                                children: "Disconnect"
                              })];
                            }
                          }), createComponent(Match, {
                            get when() {
                              return !chatClient() || chatClient()?.status === "disconnected";
                            },
                            get children() {
                              return [getNextElement(_tmpl$8), createComponent(AsyncButton, {
                                onClick: () => {
                                  setPersisted(account2().data.id, {
                                    chat: true
                                  });
                                  return chat.connectClient(account2());
                                },
                                loadingChildren: "Connecting...",
                                children: "Connect"
                              })];
                            }
                          })];
                        }
                      }));
                      return _el$10;
                    })();
                  }
                }), _el$1, _co$3);
                return _el$3;
              })();
            }
          })
        }));
        return _el$;
      })(), getNextElement(_tmpl$2)];
    }
  });
};
export {
  Settings as default
};
