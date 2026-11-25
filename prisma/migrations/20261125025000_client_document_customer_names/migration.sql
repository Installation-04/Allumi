BEGIN;
-- Match the contract input and existing customer/company name limits.
ALTER TABLE client_document DROP CONSTRAINT client_document_customer_name_check;
ALTER TABLE client_document ADD CONSTRAINT client_document_customer_name_check CHECK(mileage_text_valid(customer_name,1,200));
COMMIT;
