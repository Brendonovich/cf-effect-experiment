import { getRun } from "workflow/api";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const run = getRun((await context.params).id);
  const status = await run.status;
  if (status === "completed")
    return Response.json({ status: "complete", output: await run.returnValue });
  if (status === "failed" || status === "cancelled") {
    try {
      await run.returnValue;
    } catch (error) {
      return Response.json({ status: "errored", error: String(error) });
    }
    return Response.json({ status: "errored" });
  }
  return Response.json({ status });
}
