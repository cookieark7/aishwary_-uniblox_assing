import { TopBar } from '../components/common/layout/TopBar.js';
import { Button } from '../components/common/ui/Button.js';
import { Callout } from '../components/common/ui/Callout.js';
import { ScenarioCard } from '../components/lab/ScenarioCard.js';
import { LAB_SCENARIOS } from '../lib/constants/lab-scenarios.js';
import { SECTIONS } from '../lib/constants/sections.js';
import { runAll, runScenario } from '../lib/state/lab.js';
import { h } from '../lib/utils/dom.js';

export function LabPage(state) {
  const { runs } = state.lab;
  const anyRunning = Object.values(runs).some((r) => r.status === 'running');

  return [
    TopBar({
      section: SECTIONS.lab,
      actions: Button({
        label: 'Run all',
        icon: 'play',
        variant: 'primary',
        loading: anyRunning,
        focusKey: 'run-all',
        onClick: runAll,
      }),
    }),
    Callout({
      tone: 'warning',
      icon: 'alert',
      title: 'These run against the real database',
      text: h(
        'span',
        null,
        'Scenarios marked “writes orders” place real orders and use real stock in the database this server points at. Reset it any time with ',
        h('code', null, 'npm run db:setup'),
        '. Every request appears in the Network panel, labelled by scenario.',
      ),
    }),
    h(
      'div',
      { class: 'scenarios' },
      LAB_SCENARIOS.map((scenario) =>
        ScenarioCard({ scenario, run: runs[scenario.key], onRun: () => runScenario(scenario.key) }),
      ),
    ),
  ];
}
