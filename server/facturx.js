// Factur-X / EN 16931 (CII D16B) — XML structuré embarqué dans le PDF des factures émises.
// Profil EN16931 : celui attendu pour la réforme française de la facturation électronique.
import { round2 } from './db.js';

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const d8 = (d) => String(d || '').slice(0, 10).replace(/-/g, '');
const a = (n) => Math.abs(round2(n)).toFixed(2);
const digits = (s) => String(s || '').replace(/\D/g, '');
export const FX_PROFILE = 'urn:cen.eu:en16931:2017';

function address(p) {
  return `<ram:PostalTradeAddress>${p.postal ? `<ram:PostcodeCode>${esc(p.postal)}</ram:PostcodeCode>` : ''}${p.address ? `<ram:LineOne>${esc(p.address)}</ram:LineOne>` : ''}${p.city ? `<ram:CityName>${esc(p.city)}</ram:CityName>` : ''}<ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>`;
}

/** Calcule les montants EN16931 à partir des lignes (une ligne par taux de TVA). */
export function fxTotals(inv) {
  const byRate = {};
  for (const l of inv.lines) byRate[l.vat] = round2((byRate[l.vat] || 0) + Math.abs(l.base_ht));
  const taxes = Object.entries(byRate).map(([rate, basis]) => ({ rate: Number(rate), basis, tax: round2((basis * Number(rate)) / 100) }));
  const ht = round2(taxes.reduce((s, t) => s + t.basis, 0)); const tva = round2(taxes.reduce((s, t) => s + t.tax, 0));
  return { taxes, ht, tva, ttc: round2(ht + tva) };
}

export function buildFacturX(inv, S) {
  const credit = inv.kind === 'avoir'; const T = fxTotals(inv); const c = inv.contact;
  const buyerSiret = digits(c.siret); const sellerSiret = digits(S.company_siret);
  const lines = inv.lines.map((l, i) => `<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct><ram:Name>${esc(l.label)}</ram:Name></ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${a(l.base_ht)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">1</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${Number(l.vat).toFixed(2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${a(l.base_ht)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`).join('');
  const taxes = T.taxes.map((t) => `<ram:ApplicableTradeTax><ram:CalculatedAmount>${a(t.tax)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${a(t.basis)}</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${t.rate.toFixed(2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`).join('');
  const quoteRef = inv.quotes?.[0]?.number;
  const notes = [['PMD', "Indemnité forfaitaire de recouvrement : 40 €"], ['PMT', "Pénalités de retard : 3 fois le taux d'intérêt légal"], ['AAB', "Pas d'escompte pour paiement anticipé"], ['AAI', "Catégorie d'opération : prestations de services (travaux)"], ['REG', `${S.company_name} — ${S.company_legal_form} au capital de ${S.company_capital} €`]];
  const noteXml = notes.map(([code, txt]) => `<ram:IncludedNote><ram:Content>${esc(txt)}</ram:Content><ram:SubjectCode>${code}</ram:SubjectCode></ram:IncludedNote>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${FX_PROFILE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument><ram:ID>${esc(inv.number)}</ram:ID><ram:TypeCode>${credit ? '381' : '380'}</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${d8(inv.issued_at || inv.created_at)}</udt:DateTimeString></ram:IssueDateTime>${noteXml}</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>${lines}
<ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty><ram:Name>${esc(S.company_name)}</ram:Name>${sellerSiret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${sellerSiret}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}${address({ postal: (S.company_address.match(/\b\d{5}\b/) || [])[0], address: S.company_address.replace(/,?\s*\d{5}.*$/, ''), city: S.company_address.replace(/^.*\b\d{5}\s*/, '') })}<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${esc(S.company_vat_number.replace(/\s/g, ''))}</ram:ID></ram:SpecifiedTaxRegistration></ram:SellerTradeParty><ram:BuyerTradeParty><ram:Name>${esc(c.company || c.name)}</ram:Name>${buyerSiret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${buyerSiret}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}${address(c)}</ram:BuyerTradeParty>${quoteRef ? `<ram:ContractReferencedDocument><ram:IssuerAssignedID>${esc(quoteRef)}</ram:IssuerAssignedID></ram:ContractReferencedDocument>` : ''}</ram:ApplicableHeaderTradeAgreement>
<ram:ApplicableHeaderTradeDelivery>${inv.project?.address ? `<ram:ShipToTradeParty><ram:Name>${esc(inv.project.title)}</ram:Name>${address(inv.project)}</ram:ShipToTradeParty>` : ''}</ram:ApplicableHeaderTradeDelivery>
<ram:ApplicableHeaderTradeSettlement><ram:PaymentReference>${esc(inv.number)}</ram:PaymentReference><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>${credit || !(S.company_iban || '').trim() ? '' : `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(S.company_iban.replace(/\s/g, ''))}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${S.company_bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(S.company_bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}</ram:SpecifiedTradeSettlementPaymentMeans>`}${taxes}${credit || !inv.due_at ? '' : `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${d8(inv.due_at)}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`}<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${a(T.ht)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${a(T.ht)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">${a(T.tva)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${a(T.ttc)}</ram:GrandTotalAmount><ram:DuePayableAmount>${a(T.ttc)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>${credit && inv.credit_src?.number ? `<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${esc(inv.credit_src.number)}</ram:IssuerAssignedID>${inv.credit_src.issued_at ? `<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">${d8(inv.credit_src.issued_at)}</qdt:DateTimeString></ram:FormattedIssueDateTime>` : ''}</ram:InvoiceReferencedDocument>` : ''}</ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
}

/** Métadonnées XMP Factur-X (schéma d'extension PDF/A) à ajouter au document. */
export const FX_XMP = (filename = 'factur-x.xml') => `
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>Name of the embedded XML invoice file</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The actual version of the Factur-X XML schema</pdfaProperty:description></rdf:li>
<rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>The conformance level of the embedded Factur-X data</pdfaProperty:description></rdf:li>
</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${filename}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel></rdf:Description>
`;
