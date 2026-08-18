import { Book, Group } from "bkper-js";
import { EventHandlerGroup } from "./EventHandlerGroup.js";

export class EventHandlerGroupDeleted extends EventHandlerGroup {
  protected async connectedGroupNotFound(financialBook: Book, stockBook: Book, financialGroup: bkper.Group): Promise<string> {
    let bookAnchor = super.buildBookAnchor(stockBook);
    return `${bookAnchor}: GROUP ${financialGroup.name} NOT Found`;
  }
  protected async connectedGroupFound(financialBook: Book, stockBook: Book, financialGroup: bkper.Group, stockGroup: Group): Promise<string> {
    await stockGroup.remove();
    let bookAnchor = super.buildBookAnchor(stockBook);
    return `${bookAnchor}: GROUP ${stockGroup.getName()} DELETED`;
  }

}