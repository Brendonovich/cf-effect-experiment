import { S as SignUpForm } from "./Forms-B9BXEkzt.js";
import { l as useNavigate } from "./routing-DEHGCM-R.js";
import { b as createComponent } from "./solid-COykZtSy.js";
import "./web-BrXyZ-Hv.js";
import "./api-Bu41SY_-.js";
import "./action-EmZbM2bN.js";
import "./input-C0_oeT8V.js";
import "./button-BRzb2Wkz.js";
function signup() {
  const navigate = useNavigate();
  return createComponent(SignUpForm, {
    onLogin: () => navigate("/login"),
    onSignup: () => navigate("/")
  });
}
export {
  signup as default
};
