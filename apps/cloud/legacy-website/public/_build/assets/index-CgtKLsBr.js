import { L as LoginForm } from "./Forms-B9BXEkzt.js";
import { l as useNavigate } from "./routing-DEHGCM-R.js";
import { b as createComponent } from "./solid-COykZtSy.js";
import "./web-BrXyZ-Hv.js";
import "./api-Bu41SY_-.js";
import "./action-EmZbM2bN.js";
import "./input-C0_oeT8V.js";
import "./button-BRzb2Wkz.js";
function index() {
  const navigate = useNavigate();
  return createComponent(LoginForm, {
    onSignup: () => navigate("/signup"),
    onLogin: () => navigate("/")
  });
}
export {
  index as default
};
