import { RecordTableComponentInstanceContext } from '@/object-record/record-table/states/context/RecordTableComponentInstanceContext';
import { createComponentStateV2 } from '@/ui/utilities/state/component-state/utils/createComponentStateV2';

export const tableAllRowIdsComponentState = createComponentStateV2<string[]>({
  key: 'tableAllRowIdsComponentState',
  defaultValue: [],
  componentInstanceContext: RecordTableComponentInstanceContext,
});