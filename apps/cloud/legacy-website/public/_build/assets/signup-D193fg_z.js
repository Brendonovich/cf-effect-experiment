import { S as SignUpForm } from "./Forms-t1wWmU5a.js";
import { l as useNavigate } from "./routing-KR3q6KJw.js";
import { b as createComponent } from "./solid-COykZtSy.js";
import "./web-Dl2sEcME.js";
import "./api-BeJqlYcr.js";
import "./action-DEY4sCLp.js";
import "./input-3faxl7mS.js";
import "./button-dTk4F7f6.js";
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
