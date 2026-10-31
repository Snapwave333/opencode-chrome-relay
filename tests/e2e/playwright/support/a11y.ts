import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export async function axeViolations(page: Page, options: { include?: string; knownIssues?: string[] } = {}) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (options.include) builder = builder.include(options.include);
  if (options.knownIssues?.length) builder = builder.disableRules(options.knownIssues);
  const { violations } = await builder.analyze();
  return violations.map((v) => ({ rule: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) }));
}
