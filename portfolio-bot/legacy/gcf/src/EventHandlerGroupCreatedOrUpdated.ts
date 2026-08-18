import { Book, Group } from "bkper-js";
import { EventHandlerGroup } from "./EventHandlerGroup.js";

export class EventHandlerGroupCreatedOrUpdated extends EventHandlerGroup {
  protected async connectedGroupNotFound(financialBook: Book, stockBook: Book, financialGroup: bkper.Group): Promise<string> {
    let connectedGroup = await new Group(stockBook)
      .setName(financialGroup.name)
      .setHidden(financialGroup.hidden)
      .setVisibleProperties(financialGroup.properties)
      .create();
    let bookAnchor = super.buildBookAnchor(stockBook);
    return `${bookAnchor}: GROUP ${connectedGroup.getName()} CREATED`;
  }
  protected async connectedGroupFound(financialBook: Book, stockBook: Book, financialGroup: bkper.Group, stockGroup: Group): Promise<string> {
    await stockGroup
    .setName(financialGroup.name)
    .setHidden(financialGroup.hidden)
    .setVisibleProperties(financialGroup.properties)
    .update();
    let bookAnchor = super.buildBookAnchor(stockBook);
    return `${bookAnchor}: GROUP ${stockGroup.getName()} UPDATED`;
  }


}