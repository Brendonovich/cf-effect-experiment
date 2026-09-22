import { modules } from "@macrograph/workflow-runtime-test/fixture";
import { VercelRuntime } from "@macrograph/workflow-runtime-vercel";
import { FatalError } from "workflow";

async function executeNode(input: VercelRuntime.NodeStepInput) {
  "use step";
  try {
    return await VercelRuntime.runNodeStep(input, { modules });
  } catch (error) {
    throw new FatalError(String(error));
  }
}

export async function executeGraph(input: VercelRuntime.ExecutionInput) {
  "use workflow";
  return VercelRuntime.runWorkflow(input, { modules, executeNode });
}
