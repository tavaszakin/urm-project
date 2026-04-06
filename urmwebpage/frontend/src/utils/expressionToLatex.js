import { isValidElement } from "react";
import {
  getProjectionArity,
  getProjectionDisplayIndex,
} from "./mathNotation.jsx";

function normalizeTokenText(value) {
  return String(value ?? "")
    .replace(/([A-Za-z])(\d+)/g, "$1_{$2}")
    .replace(/P_(\d+)\^(\d+)/g, "P_{$1}^{$2}")
    .replace(/∸/g, "\\truncminus ");
}

function formatCalleeText(value) {
  const text = String(value ?? "").trim();

  if (!text) return "";
  if (/^P_(\d+)\^(\d+)$/.test(text)) {
    return text.replace(/^P_(\d+)\^(\d+)$/, "P_{$1}^{$2}");
  }
  if (/^[A-Za-z](?:\d+)?$/.test(text)) {
    return normalizeTokenText(text);
  }
  if (/^([A-Za-z_]+)\((.+)\)$/.test(text)) {
    const [, name, inner] = text.match(/^([A-Za-z_]+)\((.+)\)$/) ?? [];
    return `\\operatorname{${name.replace(/_/g, "\\_")}}\\left(${normalizeTokenText(inner)}\\right)`;
  }
  if (/^[A-Za-z_]+$/.test(text)) {
    return `\\operatorname{${text.replace(/_/g, "\\_")}}`;
  }

  return normalizeTokenText(text);
}

function elementToLatex(element) {
  if (!isValidElement(element)) {
    return normalizeTokenText(String(element ?? ""));
  }

  const spec = element.props?.spec;
  if (spec) {
    const index = getProjectionDisplayIndex(spec);
    const arity = getProjectionArity(spec, element.props?.fallbackArity);
    return `P_{${index}}^{${arity ?? "n"}}`;
  }

  return normalizeTokenText(String(element.props?.children ?? ""));
}

export function expressionToLatex(node, role = "text") {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") {
    return role === "callee" ? formatCalleeText(node) : normalizeTokenText(node);
  }
  if (isValidElement(node)) {
    return elementToLatex(node);
  }

  if (typeof node === "object") {
    if (node.type === "text") {
      return role === "callee" ? formatCalleeText(node.value) : normalizeTokenText(node.value);
    }

    if (node.type === "placeholder") {
      return "\\_";
    }

    if (node.type === "call") {
      const callee = expressionToLatex(node.callee, "callee");
      const args = Array.isArray(node.args)
        ? node.args.map((arg) => expressionToLatex(arg)).join(",")
        : "";
      return `${callee}\\left(${args}\\right)`;
    }
  }

  return normalizeTokenText(String(node));
}

export function chainToLatex(expressions = []) {
  return expressions
    .map((expression) => expressionToLatex(expression))
    .filter((expression) => expression && expression.trim().length > 0)
    .join("=");
}
