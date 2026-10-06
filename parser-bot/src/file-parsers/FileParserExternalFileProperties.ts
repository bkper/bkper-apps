import { ExternalExtractorClient } from '../external-extractor/ExternalExtractorClient.js';
import { ExtractorUrlLookupResult } from '../services/PromptLookupService.js';
import { FilePropertiesParser, FilePropertiesParserInput } from './FileParserInterfaces.js';
import { filterFileProperties } from './FileParserUtils.js';

export class FileParserExternalFileProperties implements FilePropertiesParser {
    constructor(private readonly lookup: ExtractorUrlLookupResult) { }

    async parse(input: FilePropertiesParserInput): Promise<Record<string, string> | undefined> {
        const client = new ExternalExtractorClient(this.lookup.url);
        const properties = await client.extractFileProperties(input.file, input.book, input.account ?? this.lookup.account, this.lookup);
        return filterFileProperties(properties);
    }
}
