import type { ProviderSelection } from '@nudge/contracts';
import type { ProviderHealth } from './ProviderSettings';
import {
  ModelSelector,
  ModelSelectorAction,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorLabel,
  ModelSelectorRadioGroup,
  ModelSelectorRadioItem,
  ModelSelectorTrigger,
} from './nexus-ui/model-selector';

export function ChatModelSelector({
  selection,
  health,
  disabled,
  onSelection,
  onRefresh,
  planModels = [],
  planAccountId,
}: {
  selection: ProviderSelection;
  health: ProviderHealth | undefined;
  disabled: boolean;
  onSelection(value: ProviderSelection): void;
  onRefresh(): void;
  planModels?: Array<{ slug: string; displayName: string }> | undefined;
  planAccountId?: string | undefined;
}) {
  const items = [
    { value: 'openai', title: 'OpenAI', description: 'Configured cloud model' },
    ...planModels.map((model) => ({
      value: `chatgpt:${model.slug}`,
      title: model.displayName,
      description: 'ChatGPT plan',
    })),
    ...Array.from(new Set(health?.ollama.models ?? [])).map((model) => ({
      value: `ollama:${model}`,
      title: model,
      description: 'Local · Ollama',
    })),
  ];
  const value =
    selection.provider === 'openai'
      ? 'openai'
      : selection.provider === 'chatgpt'
        ? `chatgpt:${selection.model}`
        : `ollama:${selection.model}`;
  // Keep a saved, currently unavailable selection readable without offering it as a new choice.
  const displayItems = items.some((item) => item.value === value)
    ? items
    : [
        ...items,
        {
          value,
          title:
            selection.provider === 'ollama' || selection.provider === 'chatgpt'
              ? selection.model
              : 'OpenAI',
        },
      ];
  return (
    <ModelSelector value={value} items={displayItems}>
      <ModelSelectorTrigger aria-label="Choose model" disabled={disabled} />
      <ModelSelectorContent>
        <ModelSelectorGroup>
          <ModelSelectorLabel>Choose model</ModelSelectorLabel>
          <ModelSelectorRadioGroup
            value={value}
            onValueChange={(next) => {
              if (next === 'openai') onSelection({ provider: 'openai' });
              else if (next.startsWith('chatgpt:') && planAccountId) {
                const model = next.slice('chatgpt:'.length);
                if (planModels.some((item) => item.slug === model))
                  onSelection({ provider: 'chatgpt', accountId: planAccountId, model });
              } else if (next.startsWith('ollama:')) {
                const model = next.slice('ollama:'.length);
                if (health?.ollama.available && health.ollama.models.includes(model))
                  onSelection({
                    provider: 'ollama',
                    model,
                    baseUrl:
                      selection.provider === 'ollama'
                        ? selection.baseUrl
                        : 'http://127.0.0.1:11434',
                  });
              }
            }}
          >
            {items.map((item) => (
              <ModelSelectorRadioItem
                key={item.value}
                {...item}
                disabled={
                  item.value === 'openai'
                    ? !health?.openai.available
                    : item.value.startsWith('chatgpt:')
                      ? false
                      : !health?.ollama.available
                }
              />
            ))}
          </ModelSelectorRadioGroup>
          {!health ? (
            <p className="model-selector__notice">Checking available models…</p>
          ) : !health.ollama.models.length ? (
            <p className="model-selector__notice">No local models found.</p>
          ) : null}
          <ModelSelectorAction onSelect={onRefresh}>Refresh models</ModelSelectorAction>
        </ModelSelectorGroup>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
