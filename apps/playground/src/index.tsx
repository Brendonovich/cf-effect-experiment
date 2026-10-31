import { render } from "@solidjs/web";
/* @refresh reload */

import { Playground } from "./Playground";
import "./index.css";

document.documentElement.classList.add("dark", "dark-theme");

const root = document.getElementById("root");
if (root !== null) render(() => <Playground />, root);
