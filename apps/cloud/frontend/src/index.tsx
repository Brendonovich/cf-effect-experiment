import { render } from "@solidjs/web";

import { CloudApp } from "./CloudApp";
import "./index.css";

document.documentElement.classList.add("dark", "dark-theme");

const root = document.getElementById("root");
if (root !== null) render(() => <CloudApp />, root);
