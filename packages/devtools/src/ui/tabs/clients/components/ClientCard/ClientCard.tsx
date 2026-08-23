import type { ReactNode } from "react";
import type { ClientEntry } from "../../../../../inspector/types";
import type { DevToolsTabId } from "../../../../shell/layout/panelTypes";
import type { TabNavigateOptions } from "../../../renderActiveTab";
import { AccordionRow } from "../../../../components/AccordionRow/AccordionRow";
import { ClientSummary } from "../ClientSummary/ClientSummary";
import { ClientDetail } from "../ClientDetail/ClientDetail";
import styles from "./ClientCard.module.css";

interface ClientCardProps {
  client: ClientEntry;
  onNavigate: (tab: DevToolsTabId, options?: TabNavigateOptions) => void;
}

export function ClientCard({ client, onNavigate }: ClientCardProps): ReactNode {
  return (
    <AccordionRow
      summary={(isOpen) => (
        <ClientSummary client={client} isOpen={isOpen} onNavigate={onNavigate} />
      )}
      rootProps={{ className: styles.card }}
    >
      <ClientDetail client={client} onNavigate={onNavigate} />
    </AccordionRow>
  );
}
