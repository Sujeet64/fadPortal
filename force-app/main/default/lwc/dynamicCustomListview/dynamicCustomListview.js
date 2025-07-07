import { LightningElement, track, wire } from 'lwc';
import getRecords from '@salesforce/apex/RecordDisplayController.getRecords';
import { NavigationMixin } from 'lightning/navigation';

export default class DynamicCustomListview extends NavigationMixin(LightningElement) {
    @track records;
    @track columns = ['Id', 'Name', 'Industry', 'phone'];
    @track error;
    configName = 'RecordToDisplay';

    @wire(getRecords, { configName: '$configName' })
    wiredRecords({ error, data }) {
        if (data) {
            // Transform records to avoid computed property access in template
            this.records = data.map(record => {
                const values = this.columns.map(column => ({
                    field: column,
                    value: record[column] || '',
                    isNameField: column === 'Name',
                    url: column === 'Name' ? this.generateRecordUrl(record.Id) : null
                }));
                return {
                    id: record.Id,
                    values: values
                };
            });
            this.error = undefined;
        } else if (error) {
            this.error = error.body.message;
            this.records = undefined;
        }
    }

    generateRecordUrl(recordId) {
        return this[NavigationMixin.GenerateUrl]({
            type: 'standard__recordPage',
            attributes: {
                recordId: recordId,
                objectApiName: 'Account',
                actionName: 'view'
            }
        }).then(url => url);
    }
}