import { AppContext } from '../AppContext.js';
import { FilePropertiesParser, FilePropertiesParserInput } from './FileParserInterfaces.js';
import { filterFileProperties } from './FileParserUtils.js';

export class FileParserGenAIFileProperties implements FilePropertiesParser {
    constructor(private readonly context: AppContext) { }

    async parse(input: FilePropertiesParserInput): Promise<Record<string, string> | undefined> {
        const extracted = await this.context.createExtractorFileProperties(input.file).extract(input.prompt);
        return filterFileProperties(extracted?.properties);
    }
}
