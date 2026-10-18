// Public API of the contacts module for server code. Client components import "@/modules/contacts/client".
export * from "./domain/contact";
export * from "./domain/item";

export {
  anonymizeContact,
  CONTACTS_PER_PAGE,
  createContact,
  deleteContact,
  getContact,
  listContacts,
  setContactActive,
  updateContact,
  type ContactDto,
  type ContactList,
} from "./service/contacts";
export { createItem, deleteItem, getItem, ITEMS_PER_PAGE, listItems, setItemActive, updateItem, type ItemDto, type ItemList } from "./service/items";
