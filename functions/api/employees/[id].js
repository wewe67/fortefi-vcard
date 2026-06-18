import employees from "../../../data/employees.json";

export function onRequestGet({ params }) {
  const match = employees.find((e) => e.id === params.id);
  if (!match) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(match);
}
