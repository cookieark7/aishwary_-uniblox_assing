import { Badge } from '../common/ui/Badge.js';
import { Button } from '../common/ui/Button.js';
import { Callout } from '../common/ui/Callout.js';
import { StatusChip } from '../common/ui/StatusChip.js';
import { h } from '../../lib/utils/dom.js';
import { formatMs } from '../../lib/utils/format.js';
import { icon as Icon } from '../../lib/utils/icons.js';

/** One chip per parallel request: its status, plus the error code or replay flag. */
function ResponseGrid(responses) {
  return h(
    'ol',
    { class: 'responses', 'aria-label': 'Responses to the parallel requests' },
    responses.map((r) =>
      h(
        'li',
        {
          class: 'responses__item',
          title: r.code ?? (r.replayed ? 'Idempotent-Replayed: true' : ''),
        },
        h('span', { class: 'responses__label' }, r.label),
        StatusChip({ status: r.status }),
        r.code ? h('span', { class: 'responses__code' }, r.code) : null,
        r.replayed ? h('span', { class: 'responses__code' }, 'replayed') : null,
        r.note ? h('span', { class: 'responses__code' }, r.note) : null,
      ),
    ),
  );
}

function Assertions(assertions) {
  return h(
    'ul',
    { class: 'assertions' },
    assertions.map((a) =>
      h(
        'li',
        { class: ['assertion', a.pass ? 'assertion--pass' : 'assertion--fail'] },
        Icon(a.pass ? 'check' : 'x', { size: 14, label: a.pass ? 'pass' : 'fail' }),
        h('span', null, a.label),
        a.detail && !a.pass ? h('span', { class: 'hint' }, ` (${a.detail})`) : null,
      ),
    ),
  );
}

/**
 * @param {{ scenario: typeof import('../../lib/constants/lab-scenarios.js').LAB_SCENARIOS[number],
 *   run: import('../../lib/state/lab.js').LabRun | undefined, onRun: () => void }} props
 */
export function ScenarioCard({ scenario, run, onRun }) {
  const running = run?.status === 'running';
  const verdict =
    run?.status === 'done'
      ? run.assertions.every((a) => a.pass)
        ? Badge({ text: 'invariant held', tone: 'success', icon: 'check' })
        : Badge({ text: 'invariant broken', tone: 'error', icon: 'x' })
      : null;

  return h(
    'article',
    { class: ['card', 'scenario'], 'aria-busy': running ? 'true' : null },
    h(
      'div',
      { class: 'card__header' },
      Icon('zap', { className: 'scenario__icon' }),
      h('h3', { class: 'card__title' }, scenario.title),
      verdict,
      scenario.consumesData
        ? Badge({ text: 'writes orders', title: 'Creates real orders and uses stock' })
        : null,
      Button({
        label: run ? 'Run again' : 'Run',
        icon: 'play',
        variant: run ? 'secondary' : 'primary',
        size: 'sm',
        loading: running,
        focusKey: `run-${scenario.key}`,
        onClick: onRun,
      }),
    ),
    h(
      'div',
      { class: 'card__body' },
      h('p', { class: 'scenario__invariant' }, scenario.invariant),
      h('p', { class: 'scenario__mechanism' }, Icon('lock', { size: 12 }), scenario.mechanism),
      run?.status === 'blocked'
        ? Callout({
            tone: 'warning',
            icon: 'info',
            title: 'Precondition not met',
            text: run.message,
          })
        : null,
      run?.status === 'error'
        ? Callout({
            tone: 'error',
            icon: 'alert',
            title: 'The scenario could not finish',
            text: run.message,
          })
        : null,
      run?.status === 'done'
        ? h(
            'div',
            { class: 'scenario__result' },
            h('div', { class: 'hint' }, `${run.summary} · ${formatMs(run.ms)}`),
            ResponseGrid(run.responses),
            Assertions(run.assertions),
          )
        : null,
    ),
  );
}
