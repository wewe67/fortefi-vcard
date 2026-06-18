import employees from "../../data/employees.json";

export function onRequestGet() {
  return Response.json(employees);
}
